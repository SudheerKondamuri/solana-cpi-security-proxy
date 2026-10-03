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

describe("Happy Path: Solana CPI Security Proxy", () => {
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
  });

  it("Initializes the Proxy Program and derives CPI signer PDA", async () => {
    // Check if proxy state already exists
    try {
      const state = await proxyProgram.account.proxyState.fetch(proxyStatePda);
      expect(state.admin.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
      return;
    } catch {
      // Not initialized yet, proceed
    }

    const tx = await proxyProgram.methods
      .initialize()
      .accountsPartial({
        proxyState: proxyStatePda,
        proxySigner: proxySignerPda,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    expect(tx).to.be.a("string");

    const state = await proxyProgram.account.proxyState.fetch(proxyStatePda);
    expect(state.admin.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
  });

  it("Initializes the Target Vault with Proxy PDA as authority", async () => {
    // Check if vault already exists
    try {
      const vault = await targetProgram.account.vault.fetch(vaultPda);
      expect(vault.authority.toBase58()).to.equal(proxySignerPda.toBase58());
      return;
    } catch {
      // Not initialized yet, proceed
    }

    const tx = await targetProgram.methods
      .initializeVault()
      .accountsPartial({
        vault: vaultPda,
        authority: proxySignerPda,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    expect(tx).to.be.a("string");

    const vault = await targetProgram.account.vault.fetch(vaultPda);
    expect(vault.authority.toBase58()).to.equal(proxySignerPda.toBase58());
    expect(vault.value.toNumber()).to.equal(0);
  });

  it("Successfully updates vault via CPI using remaining_accounts and PDA signer", async () => {
    const newValue = new anchor.BN(42);

    const tx = await proxyProgram.methods
      .proxyUpdate(newValue)
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
          pubkey: vaultPda,
          isWritable: true,
          isSigner: false,
        },
      ])
      .rpc();

    expect(tx).to.be.a("string");

    // Verify vault account state was updated on-chain
    const vault = await targetProgram.account.vault.fetch(vaultPda);
    expect(vault.value.toNumber()).to.equal(42);
    expect(vault.authority.toBase58()).to.equal(proxySignerPda.toBase58());
  });

  it("Updates vault to a second new value via CPI", async () => {
    const secondValue = new anchor.BN(9999);

    const tx = await proxyProgram.methods
      .proxyUpdate(secondValue)
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
          pubkey: vaultPda,
          isWritable: true,
          isSigner: false,
        },
      ])
      .rpc();

    expect(tx).to.be.a("string");

    const vault = await targetProgram.account.vault.fetch(vaultPda);
    expect(vault.value.toNumber()).to.equal(9999);
  });
});
