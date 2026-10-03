import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuration from environment variables
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const PORT = parseInt(process.env.RELAYER_PORT || process.env.PORT || "3000", 10);
const PROXY_PROGRAM_ID_STR =
  process.env.PROXY_PROGRAM_ID || "2em2HY5wgQa1tSz5xQbExEUDNWWBA52KGVzEWNH7oXD7";
const TARGET_PROGRAM_ID_STR =
  process.env.TARGET_PROGRAM_ID || "C8dbWuj9rvbUhR4v6Gkh3va8tpQrYvcp7qgE6shYzAoQ";

const proxyProgramId = new PublicKey(PROXY_PROGRAM_ID_STR);
const targetProgramId = new PublicKey(TARGET_PROGRAM_ID_STR);

// Load fee-payer keypair
function loadRelayerKeypair(): Keypair {
  const customPath = process.env.RELAYER_KEYPAIR_PATH;
  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const keypairPath = customPath || defaultPath;

  if (fs.existsSync(keypairPath)) {
    const secretKey = Uint8Array.from(
      JSON.parse(fs.readFileSync(keypairPath, "utf-8"))
    );
    return Keypair.fromSecretKey(secretKey);
  }

  // Fallback: check environment variable for raw secret key JSON
  if (process.env.RELAYER_PRIVATE_KEY) {
    const secretKey = Uint8Array.from(
      JSON.parse(process.env.RELAYER_PRIVATE_KEY)
    );
    return Keypair.fromSecretKey(secretKey);
  }

  console.warn(
    `[Relayer] Keypair not found at ${keypairPath}. Generating ephemeral keypair.`
  );
  return Keypair.generate();
}

const relayerKeypair = loadRelayerKeypair();
const connection = new Connection(RPC_URL, "confirmed");

// Derive PDAs for proxy program
const [proxyStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("proxy_state")],
  proxyProgramId
);

const [proxySignerPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("proxy_auth")],
  proxyProgramId
);

// Load IDL for proxy program
function loadProxyIdl(): anchor.Idl {
  const idlPaths = [
    path.join(__dirname, "../../target/idl/proxy_program.json"),
    path.join(process.cwd(), "target/idl/proxy_program.json"),
    path.join(__dirname, "../idl/proxy_program.json"),
  ];

  for (const p of idlPaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  }

  throw new Error("Proxy Program IDL not found. Please run `anchor build` first.");
}

let proxyProgram: anchor.Program;
try {
  const idl = loadProxyIdl();
  const wallet = new anchor.Wallet(relayerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  proxyProgram = new anchor.Program(idl, provider);
} catch (err: any) {
  console.warn("[Relayer] Could not initialize Anchor Program:", err.message);
}

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    relayer_pubkey: relayerKeypair.publicKey.toBase58(),
    proxy_program_id: proxyProgramId.toBase58(),
    target_program_id: targetProgramId.toBase58(),
    proxy_state_pda: proxyStatePda.toBase58(),
    proxy_signer_pda: proxySignerPda.toBase58(),
    rpc_url: RPC_URL,
  });
});

/**
 * Requirement 7: POST /api/relay/update
 * Request Schema: { "target_vault": "string (base58 pubkey)", "new_value": "number" }
 * Behavior:
 * 1. Parses the request.
 * 2. Constructs instruction calling proxy_update.
 * 3. Explicitly pushes target_program and target_vault into instruction keys array.
 * 4. Signs and submits transaction to the local validator.
 * 5. Returns { "signature": "string" } on success.
 */
app.post("/api/relay/update", async (req: Request, res: Response): Promise<void> => {
  try {
    const { target_vault, new_value } = req.body;

    // Validate inputs
    if (!target_vault || typeof target_vault !== "string") {
      res.status(400).json({
        error: "Missing or invalid parameter: target_vault must be a base58 string",
      });
      return;
    }

    if (new_value === undefined || typeof new_value !== "number" || new_value < 0) {
      res.status(400).json({
        error: "Missing or invalid parameter: new_value must be a non-negative number",
      });
      return;
    }

    let vaultPubkey: PublicKey;
    try {
      vaultPubkey = new PublicKey(target_vault);
    } catch {
      res.status(400).json({
        error: "Invalid base58 public key provided for target_vault",
      });
      return;
    }

    // Ensure proxy program is loaded
    if (!proxyProgram) {
      const idl = loadProxyIdl();
      const wallet = new anchor.Wallet(relayerKeypair);
      const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
      });
      proxyProgram = new anchor.Program(idl, provider);
    }

    // Construct the instruction calling proxy_update
    // Explicitly pushing target_program and target_vault into remaining_accounts
    const tx = await proxyProgram.methods
      .proxyUpdate(new anchor.BN(new_value))
      .accountsPartial({
        proxyState: proxyStatePda,
        proxySigner: proxySignerPda,
        payer: relayerKeypair.publicKey,
      })
      .remainingAccounts([
        {
          pubkey: targetProgramId,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: vaultPubkey,
          isWritable: true,
          isSigner: false,
        },
      ])
      .transaction();

    // Fetch latest blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = relayerKeypair.publicKey;

    // Sign and submit transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [relayerKeypair],
      {
        commitment: "confirmed",
      }
    );

    console.log(
      `[Relayer] Relay update succeeded! Vault: ${vaultPubkey.toBase58()}, Value: ${new_value}, Sig: ${signature}`
    );

    res.status(200).json({ signature });
  } catch (err: any) {
    console.error("[Relayer] Transaction failed:", err);
    res.status(500).json({
      error: "Relay transaction failed",
      details: err.message || err.toString(),
      logs: err.logs || undefined,
    });
  }
});

// Also provide alias without /api prefix for convenience
app.post("/relay/update", (req: Request, res: Response) => {
  // Delegate to /api/relay/update handler
  app._router.handle(
    Object.assign(req, { url: "/api/relay/update" }),
    res,
    () => {}
  );
});

export { app };

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Relayer API] Server listening on port ${PORT}`);
    console.log(`[Relayer API] RPC URL: ${RPC_URL}`);
    console.log(`[Relayer API] Proxy Program: ${proxyProgramId.toBase58()}`);
    console.log(`[Relayer API] Target Program: ${targetProgramId.toBase58()}`);
    console.log(`[Relayer API] Relayer Fee Payer: ${relayerKeypair.publicKey.toBase58()}`);
  });
}
