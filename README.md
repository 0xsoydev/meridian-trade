# LLM Token Exchange

A spot and perps marketplace for LLM inference, built for ETHGlobal Mumbai 2026.

Sellers list expiring provider credits as MTokens. Buyers and their agents buy through our own OpenAI-compatible router and pay over x402 on Hedera. A perp market on the venue's $/MToken index lives on 0G Galileo.

## Why

Provider credits expire and cannot be cashed out: 0G iAI credits reset daily and monthly plan allowances lapse. The venue turns that dead capacity into a priced, tradeable market, and lets an agent with no router balance pay for inference over x402.

## Stack

| Layer | What |
|---|---|
| `apps/web` | Next.js 16, router API, seller/listing/approval endpoints, x402 top-ups |
| `contracts` | Foundry: `IndexOracle`, `PerpMarket`, `MockUSDC` on 0G Galileo (`16602`) |
| `keeper` | HCS rollups, index posts, liquidations, daily payouts |
| `agents/demo` | A Hedera-paying agent: x402 top-up, router stream, World approvals, perp hedge |
| `apps/web/scripts` | `seed.ts`, `hedera-setup.ts`, `hedera-agent.ts` |

## Quickstart

```sh
pnpm install
cp .env.example apps/web/.env   # fill in the values; never commit it
pnpm --filter web db:migrate    # or: npx drizzle-kit push
pnpm --filter web seed
pnpm --filter web dev
```

On Windows PowerShell:

```powershell
Copy-Item .env.example apps/web/.env
pnpm --filter web seed
pnpm --filter web dev
```

The seed is idempotent. It creates the demo seller, two `0g` asks on `0gm-1.0-35b-a3b` (153,000 and 174,600 micro/MTok), a funded router key (printed once), funds the perp vault, mints MockUSDC for judges, lists the demo perp market and posts its first index, and writes an HCS marker.

### Demo agent

```sh
pnpm --filter web agent:setup
pnpm --filter demo-agent start
```

`agent:setup` creates a Hedera agent account, associates USDC and writes `HEDERA_AGENT_ID`, `HEDERA_AGENT_KEY` and `GALILEO_AGENT_KEY` to `.env`. Fund the printed account with 10 USDC at the Circle faucet and the printed address with 0.1 0G at the 0G faucet.

The agent tops up over x402, sets a $2 daily cap, links a human and raises the cap through World ID approvals, streams through the router, and hedges on Galileo.

## Demo path

1. `0:00` the problem: expiring credits, no cash-out.
2. `0:20` a seller verifies and lists below the list price.
3. `0:45` an agent with no router balance: request → 402 → USDC on Hedera → stream. HashScan link on screen.
4. `1:15` buy MTokens on `/trade`; the cheap ask drains into the next.
5. `1:45` the index steps; hedge on `/perps` on Galileo.
6. `2:10` the agent hits its cap; World approval: deny, then approve.
7. `2:35` `/receipts`: recompute the index from HCS.

The operator steps are in [`docs/runbook.md`](docs/runbook.md); sponsor notes and submission text are in [`docs/submission.md`](docs/submission.md).

## Deployments (testnet)

| Thing | Value |
|---|---|
| Hedera treasury | `0.0.11220913` |
| Hedera agent | `0.0.11223929` |
| HCS topic | `0.0.11222352` |
| Hedera USDC | `0.0.429274` |
| Galileo | chain `16602` |
| PerpMarket | `0xdAa33F31C682BC2bb26F15656b8987c5d948eb54` |
| IndexOracle | `0x5aA8cdD443974Be978FDeC4d83528f0183886785` |
| MockUSDC | `0x00a56d50DF396Ad754ED1F58c17B41529260A992` |
| Demo model | `0gm-1.0-35b-a3b` |

## Status

- Supply side, approvals, seed and the demo agent live on `feat/supply`; the frontend shell and spot venue are on the open `feat/frontend` PR.
- The seller onboarding backend (`/api/sellers/*`) and listing endpoints are complete. The `/sell` widget still needs the IDKit call wired by the frontend owner.
- The `/approve/[id]` page is included here so the World approval flow can be rehearsed before the frontend PR lands.

## Known limits

- Demo runs on 0G testnet. At the time of writing the only `0gm-1.0-35b-a3b` provider reports unhealthy, so streaming returns `502`; top-up, approvals and the hedge are independent of it.
- OAuth rails (Claude Code, Codex) ship flagged off (`ENABLE_OAUTH_RAILS=0`).
- Prices for non-0G rails are seeded; OAuth capacity is advisory.
- The keeper is the only index poster; it is a trusted component in the demo. The seed lists the demo market and posts an index so the demo does not depend on the keeper being up.
- World Agent Pass (OIDC) was replaced by IDKit approvals bound to an approval id. `keys.world_sub` stores the World nullifier.

## AI disclosure

Built with AI coding assistants (opencode/Claude Code and Command Code) for implementation, review and test generation. All changes were reviewed by the team and pass typecheck, tests and a production build.

## Docs

- `docs/plan.md` — the spec: units, schema, formulas, endpoints, contracts, milestones
- `docs/kt.md` — context, evidence, accounts, blockers, rejected paths
- `docs/handoff/` — one page per person
- `docs/runbook.md` — operations
- `docs/submission.md` — sponsor notes and submission text

## Branches

`develop` is the integration branch. `main` is release only. Every change starts on a branch off `develop` and merges back into `develop`.
