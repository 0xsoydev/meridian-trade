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

`pnpm --filter web og-e2e` sends one real inference through the same request the router builds and fails unless the model answers; it spends a few hundred tokens of the key's balance.

`0gm-1.0-35b-a3b` must report `is_healthy: true` before 0G inference can be shown. Prices and the model list come from `OG_MODELS_URL` (default: 0G's public mainnet `/models`). That keeps 0G markets listed and tradeable even when the testnet router has no provider for a model.

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

### Market agent

```powershell
pnpm --filter demo-agent market
```

Runs one agent through a market end to end. Under 1 HBAR it asks the Hedera Portal faucet API for 10 HBAR (`HEDERA_PAT`, a personal access token from portal.hedera.com); under 1 USDC it takes 2 USDC from the treasury, or prints the Circle faucet link and waits when the treasury is short. It then quotes a market buy of `BUY_TOKENS` (default 1 MTok) on `MODEL`, tops its router key up over x402 for the shortfall, buys, answers one prompt from the MTokens it bought, sells what is left into the bids, and lists any remainder at the best ask.

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
node --env-file=.env keeper/main.ts
pnpm --filter demo-agent start
```

Run exactly one keeper. It reads the root `.env`. On Linux, run it as a systemd user service so it survives logouts and reboots, in `~/.config/systemd/user/celestial-keeper.service`:

```ini
[Unit]
Description=Celestial Trade keeper
After=network-online.target

[Service]
WorkingDirectory=/path/to/the/repo
ExecStart=/usr/bin/systemd-inhibit --what=sleep:idle --who=keeper --why=payouts /path/to/node --env-file=.env keeper/main.ts
Restart=always
RestartSec=5
StandardOutput=append:%h/keeper.log
StandardError=append:%h/keeper.log

[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload && systemctl --user enable --now celestial-keeper` and `loginctl enable-linger $USER`. Restart it after pulling keeper or `lib` changes.

### Keeper on Render (free)

Render's free plan has no background workers, so the keeper runs as a free web service. When `PORT` is set it answers `ok` on that port, which Render needs before it calls the service live; without `PORT` nothing changes.

- New → Web Service on this repo, branch `main`, Root Directory blank, instance type Free.
- Build command `pnpm install --frozen-lockfile`; start command `node --experimental-strip-types keeper/main.ts`.
- Environment: the root `.env` (Add from .env). Render sets `PORT` itself.
- Free web services stop after 15 minutes without a request, so point a free pinger (cron-job.org or UptimeRobot) at the service's `onrender.com` URL every 5 minutes.
- Stop the local keeper (`systemctl --user disable --now celestial-keeper`) right before the first deploy goes live, so only one keeper runs.

The agent prints a HashScan link for the top-up, then two approval URLs.

Live checks against the running app (`ROUTER_URL`, default `http://localhost:3000`), on `deepseek-v4.1-flash` unless `MODEL` says otherwise:
- `pnpm --filter web e2e`:
  - wallet signup, a 0.10 USDC memo deposit, and a 0.05 USDC wallet deposit on Hedera EVM, each with its replay refused;
  - a spot buy;
  - one inference paid from prepaid tokens.
- `pnpm --filter web perps-e2e`: a 5x long and a 2x short from throwaway Galileo wallets; the keeper liquidates the long once the index falls, and the short closes in profit.

All three need an ask on the model.

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
| x402 `payment failed: fetch failed` | a facilitator is down | nothing: the router benches it for 5 min and offers from the next one; the client retries for a fresh offer |
| Payout logged "still pending after its … slot" | Hedera refused the schedule for 10 min, or the keeper stopped mid-schedule | look up a schedule with the payout id as memo on the mirror; clear `payouts.execute_at` only if none exists |
| `/perps` reads "no spot price yet" | no fills in the index window and no ask | list an ask on the model |
| `next dev` answers 500 `Symbol(drizzle:Columns)` | the dev server cached an older `schema.ts` | restart `pnpm --filter web dev` after a migration |

## 7. Evidence to keep

- x402 top-ups: `0.0.7162784@1793283780.350790133`, `0.0.7162784@1793807815.756838941`
- Memo deposit: `0.0.11223929@1793807780.705800106`
- Wallet deposit on Hedera EVM: `0x27eb2b1917ebdd27cfc157c807decf401b4ed99975303bb81aa7c7c41ee4c56c`
- Executed payout schedules: `0.0.11309252`, `0.0.11309253`, `0.0.11309255`
- Hedge on Galileo: `0x39580f2e05e803b6a9fce7aaabe982bfb637e236cac58e03080cca78fe1e3fe5`
- Keeper liquidation on Galileo: `0x81edbf8aca4bc3ef24f1d1b1d993dac4f4da891a5f430ec683e3b73257eae024`
- HCS topic: `0.0.11222352`
- Treasury: `0.0.11220913`
- Agent: `0.0.11223929`, Galileo `0x770926FA371e0BAe516917369FCCEcAE054Ad051`
