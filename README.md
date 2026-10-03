# Solana CPI Security Proxy and Relayer with Strict Trust Boundaries

A production-grade, secure Solana Cross-Program Invocation (CPI) proxy program paired with a target vault program and an off-chain Node.js Express Relayer API.

---

## Architecture Overview

```
+------------------+         POST /api/relay/update
|   Client / User  | -------------------------------------> +-----------------------+
+------------------+                                        |   Node.js Relayer     |
                                                            |   Express API         |
                                                            +-----------------------+
                                                                        |
                                                                        | Constructs Tx with remaining_accounts
                                                                        | Signs with Relayer fee-payer
                                                                        v
+-----------------------------------------------------------------------------------+
| Solana Cluster / Local Validator                                                  |
|                                                                                   |
|  +------------------------+      CPI with PDA seeds      +---------------------+  |
|  |   Proxy Program        | ---------------------------> |   Target Program    |  |
|  |   (Program A)          |                              |   (Program B)       |  |
|  |                        |                              |                     |  |
|  |  * Validates:          |                              |  * Requires:        |  |
|  |    1. target == TARGET |                              |    authority: Signer|  |
|  |    2. vault.owner == B |                              |                     |  |
|  +------------------------+                              +---------------------+  |
|              ^                                                      |             |
|              | PDA [b"proxy_auth"]                                  v             |
|       Proxy PDA Signer                                      Vault State Account   |
|       (Authority)                                           (value mutated)       |
+-----------------------------------------------------------------------------------+
```

---

## Core Requirements & Implementation Mapping

| Requirement ID | Description | Implementation Path | Verification Command |
|---|---|---|---|
| `req-1-anchor-workspace` | Dual-program workspace: Proxy & Target programs | [`programs/proxy_program/`](file:///home/omni/Projects/solana-cpi-security-proxy/programs/proxy_program), [`programs/target_program/`](file:///home/omni/Projects/solana-cpi-security-proxy/programs/target_program), [`Anchor.toml`](file:///home/omni/Projects/solana-cpi-security-proxy/Anchor.toml) | `anchor build` |
| `req-2-target-program-vault` | Target Vault requiring authority signer for updates | [`programs/target_program/src/lib.rs`](file:///home/omni/Projects/solana-cpi-security-proxy/programs/target_program/src/lib.rs) (`update_vault`) | `anchor build && anchor test` |
| `req-3-proxy-program-cpi` | Manual extraction of remaining_accounts & PDA signer CPI | [`programs/proxy_program/src/lib.rs`](file:///home/omni/Projects/solana-cpi-security-proxy/programs/proxy_program/src/lib.rs) (`proxy_update`) | `npm run test:happy` |
| `req-4-attack-arbitrary-target` | Rejection of arbitrary CPI target programs | [`tests/attacks.ts`](file:///home/omni/Projects/solana-cpi-security-proxy/tests/attacks.ts) | `npm run test:attack-target` |
| `req-5-attack-forged-account` | Rejection of forged accounts not owned by Target | [`tests/attacks.ts`](file:///home/omni/Projects/solana-cpi-security-proxy/tests/attacks.ts) | `npm run test:attack-forged` |
| `req-6-attack-missing-signer` | Enforcement of Proxy PDA signer on Target Program | [`tests/attacks.ts`](file:///home/omni/Projects/solana-cpi-security-proxy/tests/attacks.ts) | `npm run test:attack-signer` |
| `req-7-relayer-api` | Off-chain Relayer API (`POST /api/relay/update`) | [`backend/src/index.ts`](file:///home/omni/Projects/solana-cpi-security-proxy/backend/src/index.ts) | `./scripts/test-relayer.sh` |
| `req-8-docker-compose-setup` | Full containerized execution (validator + deployer + relayer) | [`docker-compose.yml`](file:///home/omni/Projects/solana-cpi-security-proxy/docker-compose.yml) | `docker-compose up -d` |
| `req-9-env-example` | Documented environment variables | [`.env.example`](file:///home/omni/Projects/solana-cpi-security-proxy/.env.example) | Checked in repository root |
| `req-10-fail-closed-validation` | Custom Anchor errors (`InvalidTargetProgram`, `InvalidVaultOwner`, etc.) | [`programs/proxy_program/src/lib.rs`](file:///home/omni/Projects/solana-cpi-security-proxy/programs/proxy_program/src/lib.rs) | `anchor test` |

---

## Program Addresses

- **Proxy Program (Program A)**: `2em2HY5wgQa1tSz5xQbExEUDNWWBA52KGVzEWNH7oXD7`
- **Target Program (Program B)**: `C8dbWuj9rvbUhR4v6Gkh3va8tpQrYvcp7qgE6shYzAoQ`

---

## Security Model: CPI Trust Boundaries

Unlike EVM contracts where `msg.sender` provides call-chain custody and vulnerabilities often arise from `delegatecall`, Solana programs operate statelessly where all accounts are passed explicitly by the transaction submitter.

When using `ctx.remaining_accounts`, Anchor does not automatically validate account ownership or program IDs. The proxy must manually enforce:
1. **Target Program Identity**: `require_keys_eq!(target_program_info.key(), TARGET_PROGRAM_ID, ProxyError::InvalidTargetProgram)`
2. **Account Ownership**: `require_keys_eq!(*vault_info.owner, TARGET_PROGRAM_ID, ProxyError::InvalidVaultOwner)`
3. **Signer Authority via PDA Seeds**: `CpiContext::new_with_signer` with `&[&[b"proxy_auth", &[bump]]]` ensuring the target program validates the authority signature.

---

## Quickstart

### 1. Build Programs
```bash
anchor build
```

### 2. Run Test Suite
```bash
# Full test suite (starts local validator automatically)
anchor test --skip-build

# Or run individual attack tests:
npm run test:attack-target
npm run test:attack-forged
npm run test:attack-signer
npm run test:happy
```

### 3. Start Relayer API
```bash
cd backend
npm install
npm run build
npm run serve
```

### 4. Test Relayer API Endpoints
```bash
# Health check
curl http://127.0.0.1:3000/health

# Submit relay update
curl -X POST http://127.0.0.1:3000/api/relay/update \
  -H "Content-Type: application/json" \
  -d '{"target_vault": "<TARGET_VAULT_PDA>", "new_value": 42}'
```

---

## Docker Compose Setup

Run the full system without manual Solana CLI setup:

```bash
docker-compose up -d
```

Services:
1. `solana-test-validator`: Local test ledger on ports `8899` and `8900`.
2. `deployer`: Transient container deploying both programs.
3. `relayer-api`: Node.js Express server on port `3000`, active after deployment.

---

## Frequently Asked Questions (FAQ)

### Q: Why use `remaining_accounts` instead of declaring target accounts in the IDL?
**A**: Declaring target accounts directly in the `#[derive(Accounts)]` struct couples the proxy's IDL to the target program's types. Using `remaining_accounts` allows the proxy to operate dynamically, but mandates manual security validation ([Anchor Account Contexts Documentation](https://www.anchor-lang.com/docs/account-context)).

### Q: Why did CPI fail with "Privilege Escalation" or "Could not create program address with signer seeds"?
**A**: When invoking CPIs using `CpiContext::new_with_signer`, the seeds passed must match the exact derivation seeds and bump of the PDA ([Solana CPI Documentation](https://solana.com/docs/core/cpi#program-derived-addresses)).
