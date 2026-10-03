#!/usr/bin/env bash
set -e

# Kill any existing processes
killall -9 solana-test-validator 2>/dev/null || true
pkill -9 -f "dist/index.js" 2>/dev/null || true
sleep 1

echo "Starting local validator..."
solana-test-validator --reset --quiet &
VALIDATOR_PID=$!
sleep 4

echo "Deploying programs..."
anchor deploy

echo "Running initial setup via happy path test..."
npm run test:happy

VAULT_PDA=$(node -e '
const { PublicKey } = require("@solana/web3.js");
const proxyProgramId = new PublicKey("2em2HY5wgQa1tSz5xQbExEUDNWWBA52KGVzEWNH7oXD7");
const targetProgramId = new PublicKey("C8dbWuj9rvbUhR4v6Gkh3va8tpQrYvcp7qgE6shYzAoQ");
const [proxySignerPda] = PublicKey.findProgramAddressSync([Buffer.from("proxy_auth")], proxyProgramId);
const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), proxySignerPda.toBuffer()], targetProgramId);
console.log(vaultPda.toBase58());
')
echo "Target Vault PDA: $VAULT_PDA"

echo "Starting Relayer backend..."
cd backend
npm run serve &
BACKEND_PID=$!
cd ..
sleep 3

echo "=== HEALTH CHECK ==="
curl -s http://127.0.0.1:3000/health
echo ""

echo "=== RELAY UPDATE TEST ==="
RELAY_RESPONSE=$(curl -s -X POST http://127.0.0.1:3000/api/relay/update \
  -H "Content-Type: application/json" \
  -d "{\"target_vault\": \"$VAULT_PDA\", \"new_value\": 88888}")
echo "Relay Response: $RELAY_RESPONSE"

echo "=== VERIFYING VAULT ON-CHAIN STATE ==="
node -e '
const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const targetProgramId = new PublicKey("C8dbWuj9rvbUhR4v6Gkh3va8tpQrYvcp7qgE6shYzAoQ");
const targetIdl = JSON.parse(fs.readFileSync("target/idl/target_program.json", "utf-8"));
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const wallet = new anchor.Wallet(anchor.web3.Keypair.generate());
const provider = new anchor.AnchorProvider(connection, wallet, {});
const program = new anchor.Program(targetIdl, provider);
(async () => {
  const vaultPubkey = new PublicKey(process.argv[1]);
  const vault = await program.account.vault.fetch(vaultPubkey);
  console.log("Vault on-chain value:", vault.value.toString());
  if (vault.value.toNumber() === 88888) {
    console.log("SUCCESS: Vault value verified on-chain as 88888!");
  } else {
    console.error("FAIL: Vault value is " + vault.value.toString() + " expected 88888");
    process.exit(1);
  }
})();
' "$VAULT_PDA"

# Cleanup
kill -9 $BACKEND_PID 2>/dev/null || true
kill -9 $VALIDATOR_PID 2>/dev/null || true
killall -9 solana-test-validator 2>/dev/null || true
echo "All done!"
