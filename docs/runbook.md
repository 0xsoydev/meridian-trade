# Runbook

Operator steps for the demo. Commands assume Windows PowerShell from the repo root unless stated otherwise.

## 1. Environment

```powershell
Copy-Item .env.example apps/web/.env
```

Fill `apps/web/.env`. Every variable must be on its own line. Required groups:

- Database: `DATABASE_URL`, `SECRETS_KEY`
- Host: `PUBLIC_HOST` (e.g. `http://localhost:3000`)
- 0G Router: `OG_ROUTER_URL`, `OG_API_KEY`
- Hedera: `HEDERA_NETWORK`, `HEDERA_TREASURY_ID`, `HEDERA_TREASURY_KEY`, `HEDERA_USDC`, `MIRROR_NODE_URL`, `HCS_TOPIC_ID`
- World: `WORLD_ISSUER`, `WORLD_ENV`, `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_VERIFY_URL`, `WORLD_APPROVAL_ACTION`
- Contracts: `NEXT_PUBLIC_GALILEO_RPC`, `NEXT_PUBLIC_PERP_MARKET`, `NEXT_PUBLIC_INDEX_ORACLE`, `NEXT_PUBLIC_MOCK_USDC`, `PERP_DEPLOY_BLOCK`
- Keeper: `KEEPER_PRIVATE_KEY`
- Agent: `HEDERA_AGENT_ID`, `HEDERA_AGENT_KEY`, `GALILEO_AGENT_KEY`, `HEDGE_MODEL`
- Seed: `SEED_ROUTER_KEY` (optional; otherwise derived from `SECRETS_KEY`)

`apps/web/.env` is gitignored. Do not paste values into chat, issues or commits.

## 2. Accounts

### Hedera treasury and HCS

1. Create a testnet account with an **ECDSA** key at `https://portal.hedera.com`.
2. Put the account ID and key in `.env`.
3. Run:

```powershell
pnpm --filter web hedera:setup
```

This associates USDC `0.0.429274` and creates the HCS topic, printing `HCS_TOPIC_ID`. Paste it into `.env`.

4. Fund USDC at `https://faucet.circle.com` (Hedera Testnet). Association must exist first.

If the portal leaves a keyless alias account (faucet transfer to an EVM address), HAPI calls return `BUSY`. Use an account created by the portal's **Create account** flow, or complete the hollow account by sending one signed EVM transaction from its ECDSA key through HashIO.

### World ID

1. `https://developer.world.org` → create an app → enable World ID 4.0.
2. Copy `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`; set `WORLD_ENV=production`.
3. Use an Orb-verified phone with the World App.
4. The approval flow reuses the `seller` action (`WORLD_APPROVAL_ACTION=seller`); one action covers seller verification and every approval. Allow repeat verifications for that action in the portal, because linking and each cap raise verify again.
5. Add a dedicated `approve` action in the portal and set the variable if you prefer separate action labels.

### 0G Router

1. `https://pc.testnet.0g.ai` → connect the funded wallet → deposit into the Router balance.
2. Create an API key (`sk-...`) and put it in `OG_API_KEY`.
3. Check the provider before a rehearsal:

```powershell
curl.exe -s -H "Authorization: Bearer $env:OG_API_KEY" "$env:OG_ROUTER_URL/providers"
```

`0gm-1.0-35b-a3b` must report `is_healthy: true`.

### OpenRouter rankings

Put any OpenRouter account key in `OPENROUTER_API_KEY`. The OpenRouter rail lists that week's top 30 models by tokens from `GET /api/v1/datasets/rankings-daily`, which needs a key. Without one, the rail is off. OpenRouter's public `/models` still prices the other rails.

### Demo agent accounts

```powershell
pnpm --filter web agent:setup
```

Creates the Hedera agent account (2 HBAR, USDC associated) and a Galileo key, writes them to `.env`, and prints:

- the agent account ID for the Circle faucet (10 USDC)
- the Galileo address for `https://faucet.0g.ai` (0.1 0G)

Wait about a minute for the agent account to appear on the mirror before it pays.

## 3. Database and seed

```powershell
pnpm --filter web db:migrate
pnpm --filter web seed
```

The seed is idempotent and resets the demo state:

- seller `0x3b036a01d0785be98a260e939df4f1779daf04fa`
- two `0g` asks on `0gm-1.0-35b-a3b`: 153,000 micro/MTok for 120,000 tokens, and 174,600 for 1,000,000 tokens
- a funded router key, printed once
- vault funded, 100 MockUSDC minted to the team wallet
- the demo perp market listed if missing, and a fresh index posted if stale
- an HCS marker when the topic is empty

Re-run it any time to restore the listings and the key balance.

## 4. Run

```powershell
pnpm --filter web dev
pnpm --filter demo-agent start
```

The agent prints a HashScan link for the top-up, then two approval URLs.

`pnpm --filter web e2e` runs the human money path against the dev server: wallet signup, a 0.10 USDC memo deposit from the agent account, the replay refused, a spot buy, one inference paid from prepaid tokens.

## 5. Approvals

Approval is a World ID QR scan, not a code typed anywhere. The six-character code in the log is only a reference.

1. Open the printed `http://localhost:3000/approve/<id>` **in a browser on the same machine**.
2. Click **Verify with World ID**.
3. Scan the QR with the World App on the orb-verified phone and approve.
4. The agent's poll flips to `approved`.

Click **Deny this request** instead to record an explicit refusal: the page calls `POST /api/v1/approvals/:id/deny`, the row moves to `denied`, the poll returns it and the agent prints the deny path. A denied approval cannot be verified afterwards. Not approving within ten minutes exercises the expiry path instead.

The first approval links the human to the agent's router key. The second raises the daily cap. A cap raise on a key with no linked human answers 403 with a `link_human` approval, so the client links first rather than waiting out a `raise_cap` that can never succeed.

To test without a World App, set `NEXT_PUBLIC_WORLD_BYPASS=true` in both env copies and restart `pnpm dev`:

- Seller verification and approvals then skip the World proof. Each wallet counts as its own test human for `/sell`, and each key has one test human for its approvals.
- Every bypassed button says "test bypass".
- Production builds ignore the flag.
- Set it back to `false` before recording the demo.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `502 every candidate failed` | 0G provider unhealthy | check `/providers`; wait or use another model |
| `MarketUnknown()` | perp market not listed | re-run the seed (it lists the demo market) |
| `StalePrice()` | index older than 600s | re-run the seed, or start the keeper |
| Hedera `BUSY` | keyless alias account | use a keyed account, or complete the hollow account with an EVM tx |
| `fetch failed` in the agent | app not running | start `pnpm --filter web dev` first |
| Approval stays `pending` | no proof submitted | open the URL and approve; the agent waits 90s |
| Env value includes the next variable | missing newline | one variable per line |

## 7. Evidence to keep

- x402 top-up: `0.0.7162784@1793283780.350790133`
- Hedge on Galileo: `0x39580f2e05e803b6a9fce7aaabe982bfb637e236cac58e03080cca78fe1e3fe5`
- HCS topic: `0.0.11222352`
- Treasury: `0.0.11220913`
- Agent: `0.0.11223929`, Galileo `0x770926FA371e0BAe516917369FCCEcAE054Ad051`
