import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import * as path from "path";
import * as os from "os";
import { ProxyProgram } from "../target/types/proxy_program";
import { TargetProgram } from "../target/types/target_program";

// Default ANCHOR env vars if running directly via mocha / npm scripts
if (!process.env.ANCHOR_PROVIDER_URL) {
  process.env.ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899";
}
if (!process.env.ANCHOR_WALLET) {
  process.env.ANCHOR_WALLET = path.join(os.homedir(), ".config", "solana", "id.json");
}

describe("Attack Tests: CPI Trust Boundaries & Account Validation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const proxyProgram = anchor.workspace.ProxyProgram as Program<ProxyProgram>;
  const targetProgram = anchor.workspace.TargetProgram as Program<TargetProgram>;

  let proxyStatePda: PublicKey;
  let proxySignerPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Derive Proxy State PDA: seeds = ["proxy_state"]
    [proxyStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proxy_state")],
      proxyProgram.programId
    );

    // Derive Proxy Signer PDA: seeds = ["proxy_auth"]
    [proxySignerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proxy_auth")],
      proxyProgram.programId
    );

    // Derive Vault PDA: seeds = ["vault", proxySignerPda]
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), proxySignerPda.toBuffer()],
      targetProgram.programId
    );

    // Ensure Proxy is initialized
    try {
      await proxyProgram.account.proxyState.fetch(proxyStatePda);
    } catch {
      await proxyProgram.methods
        .initialize()
        .accountsPartial({
          proxyState: proxyStatePda,
          proxySigner: proxySignerPda,
          admin: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Ensure Vault is initialized
    try {
      await targetProgram.account.vault.fetch(vaultPda);
    } catch {
      await targetProgram.methods
        .initializeVault()
        .accountsPartial({
          vault: vaultPda,
          authority: proxySignerPda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  // =========================================================================
  // Requirement 4: Arbitrary CPI Target Rejection
  // =========================================================================
  it("rejects arbitrary CPI target programs (arbitrary target attack)", async () => {
    // Fetch initial vault value before attack
    const vaultBefore = await targetProgram.account.vault.fetch(vaultPda);
    const initialValue = vaultBefore.value.toNumber();

    // Malicious target program ID (e.g. SystemProgram or an attacker's dummy program)
    const maliciousProgramId = SystemProgram.programId;
    const maliciousValue = new anchor.BN(1337);

    let failedAsExpected = false;
    try {
      await proxyProgram.methods
        .proxyUpdate(maliciousValue)
        .accountsPartial({
          proxyState: proxyStatePda,
          proxySigner: proxySignerPda,
          payer: provider.wallet.publicKey,
        })
        .remainingAccounts([
          {
            pubkey: maliciousProgramId, // Attacker passes wrong program ID
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: vaultPda,
            isWritable: true,
            isSigner: false,
          },
        ])
        .rpc();
    } catch (err: any) {
      failedAsExpected = true;

      // Assert fail-closed: verify the error message or code matches InvalidTargetProgram (6000)
      const errorString = err.toString();
      const hasCustomError =
        errorString.includes("InvalidTargetProgram") ||
        errorString.includes("6000") ||
        errorString.includes("Invalid target program");

      expect(
        hasCustomError,
        `Expected InvalidTargetProgram error (6000), got: ${errorString}`
      ).to.be.true;
    }

    expect(failedAsExpected, "Transaction MUST revert when arbitrary CPI target is provided").to.be.true;

    // Verify Vault state remains entirely unchanged
    const vaultAfter = await targetProgram.account.vault.fetch(vaultPda);
    expect(vaultAfter.value.toNumber()).to.equal(
      initialValue,
      "Vault value must remain unchanged after blocked arbitrary target attack"
    );
  });

  // =========================================================================
  // Requirement 5: Forged Account Rejection
  // =========================================================================
  it("rejects forged accounts not owned by target program (forged account attack)", async () => {
    // Fetch initial vault value before attack
    const vaultBefore = await targetProgram.account.vault.fetch(vaultPda);
    const initialValue = vaultBefore.value.toNumber();

    // Create a dummy account owned by an attacker / SystemProgram (not target program)
    const forgedAccount = Keypair.generate();
    const maliciousValue = new anchor.BN(999999);

    let failedAsExpected = false;
    try {
      await proxyProgram.methods
        .proxyUpdate(maliciousValue)
        .accountsPartial({
          proxyState: proxyStatePda,
          proxySigner: proxySignerPda,
          payer: provider.wallet.publicKey,
        })
        .remainingAccounts([
          {
            pubkey: targetProgram.programId,
            isWritable: false,
            isSigner: false,
          },
          {
            pubkey: forgedAccount.publicKey, // Forged account not owned by Target Program
            isWritable: true,
            isSigner: false,
          },
        ])
        .rpc();
    } catch (err: any) {
      failedAsExpected = true;

      // Assert fail-closed: verify error matches InvalidVaultOwner (6001)
      const errorString = err.toString();
      const hasCustomError =
        errorString.includes("InvalidVaultOwner") ||
        errorString.includes("6001") ||
        errorString.includes("Invalid vault owner") ||
        errorString.includes("AccountNotInitialized");

      expect(
        hasCustomError,
        `Expected InvalidVaultOwner error (6001), got: ${errorString}`
      ).to.be.true;
    }

    expect(failedAsExpected, "Transaction MUST revert when forged vault account is provided").to.be.true;

    // Verify legitimate Vault state remains entirely unchanged
    const vaultAfter = await targetProgram.account.vault.fetch(vaultPda);
    expect(vaultAfter.value.toNumber()).to.equal(
      initialValue,
      "Vault value must remain unchanged after blocked forged account attack"
    );
  });

  // =========================================================================
  // Requirement 6: Missing Signer Rejection
  // =========================================================================
  it("strictly enforces Proxy PDA signature on Target Program (missing signer attack)", async () => {
    // Fetch initial vault value before attack
    const vaultBefore = await targetProgram.account.vault.fetch(vaultPda);
    const initialValue = vaultBefore.value.toNumber();

    // Attacker attempts to call target_program.methods.updateVault() directly,
    // bypassing the Proxy Program, signing with their own user keypair
    // instead of the authorized Proxy PDA.
    const attacker = Keypair.generate();
    const maliciousValue = new anchor.BN(777777);

    let failedAsExpected = false;
    try {
      await targetProgram.methods
        .updateVault(maliciousValue)
        .accountsPartial({
          vault: vaultPda,
          authority: attacker.publicKey, // Direct call with attacker keypair instead of Proxy PDA
        })
        .signers([attacker])
        .rpc();
    } catch (err: any) {
      failedAsExpected = true;

      // The transaction must revert because:
      // 1. Attacker is not the vault authority (ConstraintHasOne or ConstraintSeeds violation)
      // 2. OR if attacker passes proxySignerPda as authority, they cannot sign for it (Privilege Escalation / missing signer)
      const errorString = err.toString();
      const isExpectedError =
        errorString.includes("ConstraintHasOne") ||
        errorString.includes("ConstraintSeeds") ||
        errorString.includes("Signature verification failed") ||
        errorString.includes("unknown signer") ||
        errorString.includes("PrivilegeEscalation") ||
        errorString.includes("2001") || // ConstraintHasOne code
        errorString.includes("2006");   // ConstraintSeeds code

      expect(
        isExpectedError,
        `Expected signature/authority constraint error, got: ${errorString}`
      ).to.be.true;
    }

    expect(failedAsExpected, "Direct call without authorized Proxy PDA signer MUST revert").to.be.true;

    // Second vector: Attempting to pass proxySignerPda directly as authority without PDA seeds signature
    let missingSignatureReverted = false;
    try {
      await targetProgram.methods
        .updateVault(maliciousValue)
        .accountsPartial({
          vault: vaultPda,
          authority: proxySignerPda, // Correct authority pubkey, but NO valid signature
        })
        .rpc();
    } catch (err: any) {
      missingSignatureReverted = true;
      const errorString = err.toString();
      // Should fail with missing signature or privilege escalation
      expect(
        errorString.length > 0,
        "Transaction must revert due to missing signature"
      ).to.be.true;
    }

    expect(
      missingSignatureReverted,
      "Transaction MUST revert when authority signature is missing"
    ).to.be.true;

    // Verify legitimate Vault state remains unchanged
    const vaultAfter = await targetProgram.account.vault.fetch(vaultPda);
    expect(vaultAfter.value.toNumber()).to.equal(
      initialValue,
      "Vault value must remain unchanged after blocked missing signer attack"
    );
  });
});
