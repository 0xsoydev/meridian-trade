# Submission notes

## One line

Expiring, non-cashable LLM credits become a priced, tradeable market — and agents can pay for inference without a human in the loop.

## Problem

Provider credits expire and cannot be cashed out: 0G iAI credits reset daily, monthly plan allowances lapse. Buyers, especially agents, also need a way to pay per request without an account.

## What we built

- **Spot venue for MTokens:** sellers list unused capacity below the model's list price. Buyers take the book, or place a limit that rests as a bid. Holders resell into the bids, or list an escrowed ask that buys walk alongside the provider asks.
- **OpenAI-compatible router:** our own, so seller keys never leave the server. Buyers hold a router key and a USD balance. A request spends prepaid MTokens first, otherwise the cheapest ask, and fails over across rails.
- **Prepaid MTokens:** tied to a listing and an expiry, so a fill is a real position, not a claim.
- **Perps:** a 5x oracle perp on the venue's own $/MToken index, collateralised in USDC on 0G Galileo.
  - One-order flips and margin editing.
  - The keeper liquidates, and records every fill for the trade history.
- **Payments on Hedera:**
  - x402 top-ups, where an agent with no router balance gets a 402, pays USDC and retries;
  - deposits by memo, or from the buyer's own wallet on Hedera EVM;
  - daily seller payouts as scheduled transfers.
- **World ID at two points:** one human per seller, and a human approval to link an agent or raise its spending cap.

## 0G

- **0G rail:** inference goes through the 0G Compute Router, with prices and the model list taken from 0G's public catalog. `0gm-1.0-35b-a3b` and the other 0G models stay listed and tradeable when the testnet router lacks a provider.
- **Contracts on Galileo (`16602`):**
  - `IndexOracle` `0x5aA8cdD443974Be978FDeC4d83528f0183886785`;
  - `PerpMarket` `0xdAa33F31C682BC2bb26F15656b8987c5d948eb54`;
  - `MockUSDC` `0x00a56d50DF396Ad754ED1F58c17B41529260A992`.
- **Perp markets:** `glm-5.3`, `0gm-1.0-35b-a3b` and `deepseek-v4.1-flash`. The keeper posts each index from the venue's HCS rollups, clamped to a tenth of list up to list.
- **Keeper liquidation:** https://chainscan-galileo.0g.ai/tx/0x81edbf8aca4bc3ef24f1d1b1d993dac4f4da891a5f430ec683e3b73257eae024
- **comfy.fun agents:** `/agents` hands a comfy agent (0G mainnet) one prompt or snippet. It mints its own router key by paying over x402, its human verifies once with World ID, and only then can it connect under its comfy agent name (`PUT /api/v1/agents/comfy`). Each task goes out as `model: "cheapest:<ids>"`, filled at the lowest live ask among models good enough for it, falling through to the next model if one fails. `/agents` lists every connected comfy agent with its verified human, requests and spend.
- **Known limit:** the 0G testnet router currently has no provider for `0gm-1.0-35b-a3b`. A 0gm request returns the router's own 404, and the request's prepaid hold is released. 0G request ids will be added once a provider serves it, or with a mainnet key. Everything else, including 0gm spot and perps, works without it.

## Hedera

- x402 top-ups settle in USDC `0.0.429274` to treasury `0.0.11220913`.
- **Top-ups:**
  - https://hashscan.io/testnet/transaction/0.0.7162784-1793283780.350790133
  - https://hashscan.io/testnet/transaction/0.0.7162784-1793807815.756838941
- **Memo deposit:** https://hashscan.io/testnet/transaction/0.0.11223929-1793807780.705800106
- **Wallet deposit on Hedera EVM (chain 296):** https://hashscan.io/testnet/transaction/0x27eb2b1917ebdd27cfc157c807decf401b4ed99975303bb81aa7c7c41ee4c56c
- **HCS topic `0.0.11222352`:** carries the minute rollups, each with a Merkle root over that minute's fills. The keeper reads it back from the mirror to post the index, and `/receipts` recomputes the index from it in the browser.
- **Daily payouts:** each payout is one scheduled transfer, executed at 01:00 UTC. The first attempt pins its slot, so a retry cannot pay twice. Executed schedules:
  - https://hashscan.io/testnet/schedule/0.0.11309252
  - https://hashscan.io/testnet/schedule/0.0.11309255

## World

- Sellers prove humanity with IDKit; one nullifier maps to one seller.
- Agents link to a human and raise their daily cap through an approval bound to an approval id; the proof's signal is that id, so it cannot be replayed against another approval.
- The approval page has an explicit deny action: a refusal sets the row to `denied`, and it cannot be verified afterwards.
- The backend rejects a cap raise by a different human, asks an unlinked key to link first, and expires approvals after ten minutes.
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

The shot list and lines are in [`demo-script.md`](demo-script.md).

1. The problem: credits expire, cannot be withdrawn.
2. A seller verifies and lists below the list price.
3. An agent with no router balance: 402, USDC on Hedera, streamed answer, HashScan link.
4. Buy MTokens; resell part into a bid and list the rest.
5. Hedge on Galileo: long, add margin, flip in one order.
6. Hit the cap; World approval, denied path then approved path.
7. Recompute the index from the public HCS log on `/receipts`.

## AI disclosure

Implementation, review and tests were produced with AI coding assistants (opencode/Claude Code and Command Code). Every change was reviewed by the team and checked with typecheck, tests and a production build.

## Known limits

- OAuth rails are flagged off (`ENABLE_OAUTH_RAILS=0`) and are not part of the product.
- The keeper is a trusted index poster in this build.
- A perp market with no fills and no asks has no spot price, so trading closes until a seller lists.
- The 0G testnet provider gap described above.
