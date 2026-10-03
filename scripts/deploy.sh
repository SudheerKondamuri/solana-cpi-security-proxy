#!/usr/bin/env bash
set -e

RPC_URL="${RPC_URL:-http://solana-test-validator:8899}"
echo "[Deployer] Target RPC URL: $RPC_URL"

# Wait for Solana validator to become available
echo "[Deployer] Waiting for validator to be responsive..."
RETRIES=60
until curl -s "$RPC_URL" > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  echo "[Deployer] Waiting for validator ($RETRIES retries remaining)..."
  sleep 2
  RETRIES=$((RETRIES - 1))
done

if [ $RETRIES -eq 0 ]; then
  echo "[Deployer] ERROR: Timed out waiting for validator."
  exit 1
fi

echo "[Deployer] Validator is responsive! Checking cluster version..."
solana cluster-version -u "$RPC_URL" || true

# Ensure deployer wallet exists
mkdir -p /root/.config/solana
if [ ! -f /root/.config/solana/id.json ]; then
  echo "[Deployer] Generating deployer keypair..."
  solana-keygen new --no-bip39-passphrase -s -o /root/.config/solana/id.json --force
fi

# Request airdrop for deployer
echo "[Deployer] Requesting airdrop for deployer wallet..."
solana airdrop 100 /root/.config/solana/id.json -u "$RPC_URL" || true

# Deploy programs using pre-compiled binaries or anchor deploy
if [ -f "target/deploy/target_program.so" ] && [ -f "target/deploy/proxy_program.so" ]; then
  echo "[Deployer] Deploying target_program.so..."
  solana program deploy target/deploy/target_program.so \
    -u "$RPC_URL" \
    --program-id target/deploy/target_program-keypair.json \
    --keypair /root/.config/solana/id.json

  echo "[Deployer] Deploying proxy_program.so..."
  solana program deploy target/deploy/proxy_program.so \
    -u "$RPC_URL" \
    --program-id target/deploy/proxy_program-keypair.json \
    --keypair /root/.config/solana/id.json
elif command -v anchor >/dev/null 2>&1; then
  echo "[Deployer] Building and deploying via Anchor..."
  anchor build || true
  anchor deploy --provider.cluster "$RPC_URL"
else
  echo "[Deployer] ERROR: No deployable binaries or anchor CLI found."
  exit 1
fi

echo "[Deployer] Both programs successfully deployed to $RPC_URL!"
exit 0
