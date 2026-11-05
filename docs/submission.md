# Submission notes

## One line

Expiring, non-cashable LLM credits become a priced, tradeable market — and agents can pay for inference without a human in the loop.

## Problem

Provider credits expire and cannot be cashed out: 0G iAI credits reset daily, monthly plan allowances lapse. Buyers, especially agents, also need a way to pay per request without an account.

## What we built

- A spot venue for MTokens. Sellers list unused capacity below the model's list price; buyers take the book or buy at the current ask.
- Our own OpenAI-compatible router. Seller keys never leave the server; buyers hold a router key and a USD balance.
- Prepaid MTokens tied to a listing and an expiry, so a fill is a real position, not a claim.
- A perp market on the venue's own $/MToken index, collateralised in USDC on 0G Galileo.
- x402 top-ups on Hedera: an agent with no router balance gets a 402, pays USDC, and retries.
- World ID at two points: one human per seller, and a human approval to link an agent or raise its spending cap.

## 0G

- Inference through the 0G Compute Router; model `0gm-1.0-35b-a3b` on testnet.
- Contracts on Galileo (`16602`): `IndexOracle` `0x5aA8cdD443974Be978FDeC4d83528f0183886785`, `PerpMarket` `0xdAa33F31C682BC2bb26F15656b8987c5d948eb54`, `MockUSDC` `0x00a56d50DF396Ad754ED1F58c17B41529260A992`.
- The venue lists the demo perp market and posts an initial index at `180,000` micro/MTok.
- Known limit: during the final rehearsal the only `0gm-1.0-35b-a3b` provider reported `is_healthy: false`, so streaming returned `502`. The top-up, approvals and perp hedge are independent of it. Request ids will be added once the provider recovers.

## Hedera

- x402 top-ups settle in USDC `0.0.429274` to treasury `0.0.11220913`.
- Top-up transaction: `0.0.7162784@1793283780.350790133` — https://hashscan.io/testnet/transaction/0.0.7162784-1793283780.350790133
- HCS topic `0.0.11222352` carries minute rollups and the seed marker.
- The keeper schedules daily payouts and reads the public log back from the mirror.

## World

- Sellers prove humanity with IDKit; one nullifier maps to one seller.
- Agents link to a human and raise their daily cap through an approval bound to an approval id; the proof's signal is that id, so it cannot be replayed against another approval.
- The backend rejects a cap raise by a different human and expires approvals after ten minutes.
- Agent Pass (OIDC device flow) was evaluated and replaced by IDKit approvals; the current World docs do not expose the OIDC product the original plan assumed.

## Deployments

| Thing | Value |
|---|---|
| App | `PUBLIC_HOST` (set per environment) |
| Repository | https://github.com/0xsoydev/celestial-trade |
| Treasury / agent | `0.0.11220913` / `0.0.11223929` |
| HCS topic | `0.0.11222352` |
| Hedge tx | https://chainscan-galileo.0g.ai/tx/0x39580f2e05e803b6a9fce7aaabe982bfb637e236cac58e03080cca78fe1e3fe5 |

## Demo video outline

1. The problem: credits expire, cannot be withdrawn.
2. A seller verifies and lists below the list price.
3. An agent with no router balance: 402, USDC on Hedera, streamed answer, HashScan link.
4. Buy MTokens; the cheap ask drains into the next; the index steps.
5. Hedge on Galileo.
6. Hit the cap; World approval, denied path then approved path.
7. Recompute the index from the public HCS log on `/receipts`.

## AI disclosure

Implementation, review and tests were produced with AI coding assistants (opencode/Claude Code and Command Code). Every change was reviewed by the team and checked with typecheck, tests and a production build.

## Known limits

- OAuth rails are flagged off (`ENABLE_OAUTH_RAILS=0`).
- Non-0G rail prices are seeded; OAuth capacity is advisory.
- The keeper is a trusted index poster in this build.
- The 0G testnet provider outage described above.
