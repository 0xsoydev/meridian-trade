# LLM Token Exchange

A spot and perps marketplace for LLM inference, built for ETHGlobal Mumbai 2026.

Sellers list expiring provider credits as MTokens. Buyers and their agents buy through our own OpenAI-compatible router and pay over x402 on Hedera. A perp market on the venue's $/MToken index lives on 0G Galileo.

## Docs

- `docs/plan.md` — the spec: units, schema, formulas, endpoints, contracts, milestones
- `docs/kt.md` — context, evidence, accounts, blockers, rejected paths
- `docs/handoff/` — one page per person

## Layout

- `apps/web` — Next.js UI and the router API
- `contracts` — Foundry: `IndexOracle`, `PerpMarket`, `MockUSDC`
- `keeper` — index posts, liquidations, payouts
- `agents/demo` — the paying agent
- `scripts` — seed and operations

## Run

```sh
pnpm install
cp .env.example .env
pnpm dev
```

## Branches

`develop` is the integration branch. `main` is release only. Every change starts on a branch off `develop` and merges back into `develop`.
