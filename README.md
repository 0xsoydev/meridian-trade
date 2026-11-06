# Celestial Trade

An exchange for LLM inference, built for ETHGlobal Mumbai 2026.

Provider credits expire and cannot be cashed out: 0G iAI credits reset daily, and plan allowances lapse every month. Celestial Trade turns that idle capacity into a priced market:
- Sellers list it as MTokens (1,000,000 mixed tokens, three input to one output).
- Agents and people spend it through an OpenAI-compatible router at the cheapest ask, and pay in Hedera USDC over x402.
- Anyone can resell the MTokens they hold, or hedge tomorrow's price with oracle perps on 0G Galileo.

## What it does

| | |
|---|---|
| **Router** | `POST /api/v1/chat/completions`, OpenAI-compatible and streaming. It spends prepaid MTokens first, otherwise the cheapest ask across rails (0G, Command Code, OpenRouter, Anthropic, OpenAI, OpenCode Zen and Go), settled on reported usage. |
| **Payments** | x402 on Hedera: an agent with no balance gets a 402, pays in USDC, and the retry streams. People deposit by memo or from their own wallet on Hedera EVM. A daily cap and auto top-up bound what an agent can spend. |
| **Spot** | `/trade`: an order book of provider asks and resale offers, market and limit buys (a limit rests as a bid), and a Sell ticket for MTokens you hold. Below it sit balances, open orders and fills. |
| **Perps** | `/perps`: 5x oracle perps on Galileo against a vault. The index is the venue's per-minute VWAP from the public HCS log. Flips go out as close then open, margin can be added or removed, and the keeper liquidates. |
| **Sellers** | `/sell`: World ID proves one human per seller. A listing's key is checked once, then sealed (AES-256-GCM). Earnings pay out daily as scheduled Hedera transfers. |
| **Humans in the loop** | Raising an agent's cap or linking a human opens an approval that a person approves or denies with World ID. |
| **Receipts** | `/receipts` recomputes the index in the browser from the HCS log. |

Agents can read [`apps/web/public/llms.txt`](apps/web/public/llms.txt), served at `/llms.txt`.

## Stack

| Path | What |
|---|---|
| `apps/web` | Next.js 16: the router, trading and seller APIs, x402, the UI, and Drizzle on Neon Postgres |
| `contracts` | Foundry: `IndexOracle`, `PerpMarket` and `MockUSDC` on 0G Galileo (`16602`) |
| `keeper` | One Node process. It publishes HCS rollups, posts the index, liquidates, records perp history, matches resting bids, closes the day, schedules payouts and resets daily listings. |
| `agents/demo` | A Hedera-paying agent: x402 top-up, World approvals, a streamed answer and a perp hedge |
| `apps/web/scripts` | `seed.ts`, `hedera-setup.ts`, `hedera-agent.ts`, and the live checks below |

## Run it

```sh
pnpm install
cp .env.example apps/web/.env   # names only; fill in your own values, never commit them
cp apps/web/.env .env           # the keeper reads the root copy
pnpm --filter web db:migrate
pnpm --filter web seed
pnpm --filter web dev
node --env-file=.env keeper/main.ts
```

Run exactly one keeper. On Linux it can run as a systemd user service; see [`docs/runbook.md`](docs/runbook.md).

### Checks

```sh
pnpm typecheck && pnpm build && forge test --root contracts
pnpm --filter web test             # needs DATABASE_URL; chat.test.ts uses a few real model names, so run it where no live ask sits on them
pnpm --filter web e2e              # signup, memo and wallet deposits, buy, inference from prepaid
pnpm --filter demo-agent start     # x402 top-up, approvals, stream, hedge
pnpm --filter web perps-e2e        # a 5x long liquidated by the keeper, a short closed in profit
```

The live checks spend testnet USDC and HBAR, plus a fraction of a cent of the seller's provider credits.

## Testnet evidence

| What | Where |
|---|---|
| x402 top-up, an agent paying 0.50 USDC | [`0.0.7162784@1793807815.756838941`](https://hashscan.io/testnet/transaction/0.0.7162784-1793807815.756838941) |
| Memo deposit, 0.10 USDC | [`0.0.11223929@1793807780.705800106`](https://hashscan.io/testnet/transaction/0.0.11223929-1793807780.705800106) |
| Wallet deposit on Hedera EVM (chain 296) | [`0x27eb2b19…4c56c`](https://hashscan.io/testnet/transaction/0x27eb2b1917ebdd27cfc157c807decf401b4ed99975303bb81aa7c7c41ee4c56c) |
| Seller payouts, scheduled and executed | [`0.0.11309252`](https://hashscan.io/testnet/schedule/0.0.11309252), [`0.0.11309255`](https://hashscan.io/testnet/schedule/0.0.11309255) |
| Public fill log (HCS) | [`0.0.11222352`](https://hashscan.io/testnet/topic/0.0.11222352) |
| Keeper liquidation on Galileo | [`0x81edbf8a…e024`](https://chainscan-galileo.0g.ai/tx/0x81edbf8aca4bc3ef24f1d1b1d993dac4f4da891a5f430ec683e3b73257eae024) |

| Account or contract | Value |
|---|---|
| Hedera treasury | `0.0.11220913` |
| Hedera USDC | `0.0.429274` |
| PerpMarket | `0xdAa33F31C682BC2bb26F15656b8987c5d948eb54` |
| IndexOracle | `0x5aA8cdD443974Be978FDeC4d83528f0183886785` |
| MockUSDC | `0x00a56d50DF396Ad754ED1F58c17B41529260A992` |

## Demo path

1. `0:00` The problem: expiring credits with no cash-out.
2. `0:20` A seller verifies with World ID and lists a key below the list price on `/sell`.
3. `0:45` An agent with no balance: request → 402 → USDC on Hedera → the answer streams, with the HashScan link on screen.
4. `1:15` On `/trade`:
   - buy MTokens, and a limit rests as a bid;
   - resell part of what you hold into that bid, and list the rest above it;
   - the agent then spends its MTokens at charge 0.
5. `1:45` On `/perps`: the index from HCS rollups. Long, add margin, flip short in one order, and see Trade History.
6. `2:10` The agent hits its cap → a World approval: deny, then approve.
7. `2:35` `/receipts`: recompute the index from the public log. The live strip shows the keeper's latest post and the payouts.

The full script is in [`docs/demo-script.md`](docs/demo-script.md); operator steps are in [`docs/runbook.md`](docs/runbook.md).

## Known limits

- The 0G testnet router currently has no provider for `0gm-1.0-35b-a3b`. 0G models stay listed and tradeable, priced from 0G's public model list, but 0G inference waits for a testnet provider or a mainnet key. The live checks run on Command Code `deepseek-v4.1-flash`.
- A perp market with no fills and no asks has no spot price, so its index goes stale and trading closes until a seller lists it.
- The router holds seller credentials (custodial, sealed with AES-256-GCM). The keeper is the only index poster and a trusted component.
- Subscription OAuth rails (Claude Code, Codex) are switched off and are not part of the product.
- Resale proceeds stay in the reseller's key balance, which spends on inference and trades.

## AI disclosure

Built with AI coding assistants (opencode with Claude, and Command Code) for implementation, review and test generation. The team reviewed every change, and each merge passed typecheck, the test suite, a production build and CI.

## Docs

- [`docs/plan.md`](docs/plan.md): the spec, covering units, schema, formulas, endpoints, contracts and known limits
- [`docs/runbook.md`](docs/runbook.md): operations
- [`docs/submission.md`](docs/submission.md): sponsor notes and submission text
- [`docs/demo-script.md`](docs/demo-script.md): the video script and shot list
- [`docs/kt.md`](docs/kt.md), [`docs/handoff/`](docs/handoff): context and per-person handoffs

## Branches

`develop` is the integration branch, and `main` is release only. Every change starts on a branch off `develop` and merges back into `develop`.
