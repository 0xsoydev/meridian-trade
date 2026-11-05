# LLM Token Exchange — KT / Handoff

**Status:** pre-kickoff. Planning complete, no project code written.
**Event:** ETHGlobal Mumbai, 5–7 November 2026. Submission deadline Sat 7 Nov, 09:00 IST.
**Written:** 27 October 2026.
**Source of truth for specs:** `~/.opencode/plan/llm-token-exchange.md` (830 lines). This document carries the *context* — history, evidence, accounts, blockers, rejected paths — that the plan does not.

Read this first, then the plan. If you only have ten minutes, read §1, §13, §14 and §21.

---

## 1. What we are building

A marketplace for LLM inference with a derivatives market on top.

Sellers have provider credits they cannot cash out and that expire: 0G iAI credits that reset at 00:00 UTC, Claude Max monthly API credits, coding-agent plan allowances. They list that capacity as **MTokens** at a price, or at market. Buyers — people and their agents — buy through our own OpenAI-compatible router. Every request is served either from MTokens the buyer already bought, or bought at the cheapest ask at request time.

On top of the spot venue sits a **perp market** on the venue's own $/MToken index, collateralised in USDC on 0G Galileo. Sellers short to lock in tomorrow's revenue; buyers long to cap their inference costs.

Two rails make it a real economy rather than a demo: **x402 payments on Hedera**, so an agent with no account can pay for what it uses, and **World ID**, so one human cannot farm seller slots and a human has to approve an agent's spending cap being raised.

The pitch in one line: *expiring, non-cashable compute credits become a priced, tradeable market, and agents can pay for it without a human in the loop.*

---

## 2. Event constraints

| Item | Value |
|---|---|
| Deadline | Sat 7 Nov 2026, 09:00 IST |
| Track | ETHGlobal Classic |
| Partner prizes | 0G (Build with iAI + Wildcard), Hedera (AI Agents That Pay: x402), World (Agent Pass + IDKit). Up to 3 partner prizes. |
| Video | 2:30–2:55, 720p+, no AI voiceover, human narration |
| ETHGlobal rule | No project code before kickoff. The preflight suite lives outside the project repo for this reason. |
| Disclosure | AI tool use must be documented in the README |
| Hedera wants | A HashScan tx link in the README, architecture, payment flow |
| World wants | A denied path, backend validation, and a debrief |
| 0G wants | Live link, Galileo contract addresses, team Telegram/X, credits actually spent |

---

## 3. Decisions, in the order they were made

| # | Decision | Why |
|---|---|---|
| 1 | Agent route: 0G + Hedera + World | All three are agent-infrastructure sponsors; the story holds together |
| 2 | 0G Compute Router serves inference; contracts on Galileo (chain 16602); Hedera holds payments, the public log and payouts | Each chain does what it is good at |
| 3 | Our own router sits in front of everything; seller credentials never leave the server | Control of the pipeline; buyers only ever hold a router key |
| 4 | Buyers hold a USD balance on a router key; optional auto top-up through x402 | Removes per-model inventory and midnight-expiry problems |
| 5 | Auto top-up settles *before* streaming, using the facilitator's verify/settle directly | `withX402` buffers the whole response, so it cannot proxy SSE |
| 6 | Listing = model + MTokens + optional price. Blank price fills at the best limit ask | Sellers who want out before midnight accept the market |
| 7 | Asks must be below the model's reference list price | Keeps the venue cheaper than buying direct, by construction |
| 8 | Perps: isolated USDC margin, ≤5x, skew funding, 5% maintenance, 10 bps fees, house vault | Simple, auditable, demo-able |
| 9 | Index = TWAP of the venue's own fills, clamped to half..one times the reference price | The perp prices the venue, not a fantasy |
| 10 | Take rate: 10% spot, 10 bps perps | Revenue, and cheap enough not to distort the market |
| 11 | Repo: pnpm workspace `apps/web`, `contracts`, `keeper`, `agents/demo`, `scripts` | Four deployables, one lockfile |
| 12 | Later: **rails** replace "0G only" — 0G, Anthropic, OpenAI, OpenRouter, Command Code, OpenCode Zen, plus Claude Code and Codex OAuth | Coverage of every model, not just 0G's |
| 13 | **MToken redefined as a price-free mixed token** (3 input : 1 output) | A unit priced at 0G's list is not comparable across rails |
| 14 | Metering by the rail's reported token counts; a rail's cost field is display-only | Cost is not comparable across providers; tokens are |
| 15 | Market asks (blank price) only on rails whose credits expire | Paid credits sold at a 10% discount are a 10% loss |
| 16 | OAuth rails ship **flagged off** (`ENABLE_OAUTH_RAILS=0`) | Providers refuse them; the flag keeps the demo safe |
| 17 | Six pages: `/`, `/trade`, `/perps`, `/sell`, `/keys`, `/receipts` | Spot and perps are separate venues; `/sell` is onboarding only |
| 18 | Spot "buy" is a real fill that credits prepaid MTokens; prepaid expires, no refund | A trading page needs an execution, and expiring capacity cannot be honoured tomorrow |

---

## 4. Architecture

Request path:

```
Seller ──Privy──► /sell ──► World ID verify ──► rail credential (API key or OAuth) ──► listing
Buyer / agent ──rk_ key──► /api/v1/chat/completions ──► reserve ──► rail (0G, Anthropic, …)
                                │ 402 ──► x402 ──► facilitator ──► Hedera ──► retry ──► stream
                                └─ settle exactly once (end · error · cancel · deadline) ──► Neon
Human ──► /trade (spot + prepaid) · /perps (Galileo) · /keys (caps, World link) · /receipts (proof)
Keeper ──► HCS rollups ──► IndexOracle ──► liquidation ──► scheduled payouts
```

Components:

| Piece | What it is |
|---|---|
| `apps/web` | Next.js 16 on Vercel: UI, router, seller API, x402 top-up, World approvals |
| `keeper` | One Node 22 process: HCS rollups, index posts, liquidations, reservation sweep, daily payouts |
| `contracts` | Foundry: `IndexOracle`, `PerpMarket`, `MockUSDC`, deployed to Galileo |
| `agents/demo` | Hedera-paying agent: x402 top-up, OpenAI SDK through our router, then a perp hedge |
| `scripts/seed.ts` | Idempotent demo liquidity: two asks, a funded router key, vault, MockUSDC |

Data lives in Neon Postgres via Drizzle over `neon-http`. That driver has **no interactive transactions**, so every money write is a single statement (conditional `UPDATE … RETURNING` or one CTE). Lock order across tables is usage → listing → key.

---

## 5. Market mechanics

- **1 MToken = 1,000,000 mixed tokens**, where a mixed token is `(3 × prompt + completion) / 4`. Price-free by construction, so capacity is comparable across rails.
- **Reference price** per model = the enabled rail with the lowest blended list price. Asks must be strictly below it.
- **Ask with no price** falls back to 90% of the reference — but only on rails with expiring credits. Otherwise the model has no bid and the router returns `no_liquidity`.
- **A request** is served either entirely from prepaid MTokens or entirely at the current ask. Never a mix, which keeps `charge = 0` an unambiguous marker.
- **A spot fill** (`POST /api/v1/trades`) walks the book cheapest first, takes the seller's capacity for that period, debits the buyer, and credits prepaid MTokens tied to that listing. The seller is paid at fill time through the `trades` row.
- **Prepaid expires** with the seller's credit period and is not refunded. The capacity was set aside and the seller was paid.
- **Metering** uses the rail's token counts. 0G's billed cost and OpenRouter's `usage.cost` are recorded for display, never for charging.
- **Fees:** 10% of spot charge (`TAKE_BPS=1000`), 10 bps of perp notional.
- **Index:** mean of per-minute VWAPs over `INDEX_WINDOW_MIN`, clamped to `[reference/2, reference]`. 60 minutes in production, 10 for the demo.
- **Funding:** skew-based, accrues on any `modify` or `liquidate`; no keeper job needed.

---

## 6. Chains and contracts

| Chain | Use |
|---|---|
| 0G Compute Router | Inference. Mainnet `https://router-api.0g.ai/v1`; testnet `https://router-api-testnet.integratenetwork.work/v1` (only `0gm-1.0-35b-a3b`, 10 req/min) |
| 0G Galileo (16602) | `IndexOracle`, `PerpMarket`, `MockUSDC` |
| Hedera testnet | x402 settlement (USDC), HCS public log, scheduled seller payouts, treasury |
| World | IDKit seller proofs; Agent Pass device flow for linking a human and raising caps |

`IndexOracle.post(market, price, seqFrom, seqTo)` accepts a move of at most 10% from the last post (no limit on a market's first post); the keeper clamps its own posts so large moves converge instead of reverting. Staleness is 600 s.

`PerpMarket.modify(market, sizeDelta, marginDelta)` handles open, increase, reduce and close; flipping is rejected. `liquidate` pays the liquidator up to 50 bps of notional out of remaining equity, the rest goes to the vault. Underwater closes pay the trader zero. The vault is the only counterparty.

Market id = `keccak256(model)`.

---

## 7. Rails

| Rail | Protocol | Auth | Notes |
|---|---|---|---|
| `0g` | openai-chat | key | trust + max-price headers; live prices; credits reset daily |
| `anthropic` | openai-chat | key | Anthropic's OpenAI-compatible layer at `/v1`; workspace key; Max/Team credits are monthly |
| `openai` | openai-chat | key | project key with a budget |
| `openrouter` | openai-chat | key | live prices; `GET /api/v1/key` returns remaining credits |
| `commandcode` | openai-chat | key | Provider API; plan credits |
| `zen` | openai-chat | key | OpenCode Zen gateway |
| `claude-code` | anthropic-messages | oauth | flagged off |
| `codex` | openai-responses | oauth | flagged off |

Rails are **static config** in `lib/rails.ts`. Adding a provider is one entry. The two OAuth rails need protocol translators in `lib/translate.ts`, which is the only genuinely new code in that area.

---

## 8. Data model

`sellers`, `listings`, `keys`, `topups`, `usage`, `trades`, `prepaid`, `payouts`, `approvals`.

The non-obvious ones:

- `usage` is one row per request attempt: `open` at reservation, closed exactly once as `settled` or `released`. The `open` row is what the keeper sweep releases when a serverless function dies mid-request.
- `trades` is a spot fill: capacity taken, money moved, a price observed. It feeds both payouts and the price index.
- `prepaid` is MTokens owed to a buyer against a specific listing, with an expiry.
- `listings.status` includes `pending_auth` for a listing waiting on an OAuth callback.

All money is `bigint` in USD micro; all token counts are `bigint`; JSON carries them as decimal strings.

---

## 9. API surface

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/chat/completions` | `Bearer rk_` (+ `PAYMENT-SIGNATURE` on retry) |
| POST | `/api/v1/topup?usd=` | none (creates a key) or bearer |
| POST | `/api/v1/trades` | bearer |
| GET | `/api/v1/book?model=` | none |
| GET | `/api/v1/models` | none |
| GET | `/api/v1/balance` | bearer |
| PATCH | `/api/v1/keys/settings` | bearer |
| POST/GET | `/api/v1/approvals`, `/approvals/:id` | bearer |
| POST/GET | `/api/oauth/:rail/start`, `/callback` | signed intent / state |
| POST/PATCH/DELETE | `/api/listings`, `/api/listings/:id` | wallet-signed intent |

There is no `/api/keys` login. The key **is** the credential, sent as a bearer on every call, and it is created by the first top-up. `/keys` in the browser is a settings page for a human who already has one, not an authentication step.

Seller mutations carry a wallet signature over a canonical message with a domain, a timestamp and a `client_nonce`; replays are blocked by unique constraints.

---

## 10. Pages

| Page | Purpose |
|---|---|
| `/` | Markets overview and navigation |
| `/trade` | Spot venue for both sides: ask book, Buy, and a Sell form that amends price, adds capacity or cancels your own asks |
| `/perps` | Index chart, funding, long/short, positions, MockUSDC faucet |
| `/sell` | One-time setup: World verify, add a source, new listing, earnings, payouts |
| `/keys` | Human control panel: balance, auto top-up, daily cap, default model, World link |
| `/receipts` | Proof page: HCS rollups, top-ups, index posts, and a browser-side index recompute |

Charts use Lightweight Charts **v5** (`chart.addSeries(LineSeries, …)`, `UTCTimestamp` in seconds, `series.update()` for new points, `chart.remove()` on teardown, client-only under Next.js). The v4 API names do not exist in v5 and most examples online are v4.

---

## 11. Keeper jobs

| Every | Job |
|---|---|
| 60 s | Roll up the previous minute per model (trades + paid usage) to HCS; wake the index post if that minute had fills |
| 60 s | Release `open` usage rows older than 6 minutes (a function died mid-request) |
| 180 s or woken | Read the public rollups back from the mirror, compute the TWAP, clamp, post to `IndexOracle` when it moved ≥10 bps or 5 min have passed |
| 30 s | Scan `PositionModified` accounts, liquidate anything below maintenance |
| 00:00 UTC | Insert payouts for unpaid usage and trades, schedule USDC transfers for 01:00, reset daily listings |
| 01:05 UTC | Check scheduled transfers executed |

Payout idempotency: `(seller_id, day)` unique, usage rows linked in the same statement, deterministic schedule inputs so Hedera answers `IDENTICAL_SCHEDULE_ALREADY_CREATED` with the existing id.

---

## 12. What is verified (evidence)

All of this was run against testnet, not inferred from docs.

**Preflight suite** at `~/ethglobal-preflight` (deliberately outside the project repo):

- 26 tests that need no keys pass. `next build` passes. `tsc` clean.
- Hedera keyed tier: 10/10, using the HBAR fallback because the account has no USDC. Real x402 settlements:
  - `0.0.9185802@1793113830.692484163` (x402.org facilitator)
  - `0.0.7162784@1793113834.340312160` (Blocky402 facilitator)
  - The facilitator paid the network fee in both. HCS messages readable in 4–6 s. A scheduled payout executed, and a deleted one never ran.
- Galileo: deploy 128,214 gas (0.000513 0G), price update 43,696 gas (0.000175 0G). Contract `0xe3ca49812a6f8494abb4f8628549d7f3b3c01501`.
- 0G Payment Layer: 0.07 0G deposited via `depositFor(address)` into testnet `0x0AD9690e0b34aB2d493DE02cDF149ee34f6C9939` for `0x3b036A01D0785bE98A260e939dF4F1779DAf04FA`. Tx `0xb361b77706b7ff59ce8702417af25aef06045f942f13b005bb87934db0e2ed88`.

**Package behaviour confirmed by reading the installed types:**

- x402 v2 `PaymentPayload.accepted` carries the requirements the client signed, so the server can settle the amount the client actually paid rather than re-deriving it.
- `x402ResourceServer` exposes `buildPaymentRequirements`, `createPaymentRequiredResponse`, `findMatchingRequirements`, `verifyPayment`, `settlePayment` — the manual path the router uses.
- The browser paywall ships EVM, Solana and Algorand builds, **no Hedera**. Buyers pay from agents or the CLI.
- `@privy-io/server-auth` is deprecated; the plan avoids a Privy server SDK entirely by using wallet-signed mutations.

**Provider facts confirmed from docs:**

- Anthropic ships an OpenAI-compatible layer at `https://api.anthropic.com/v1` (messages, `max_tokens`, streaming, tools, `usage.prompt_tokens`). It silently ignores unsupported fields, has no prompt caching, and is described by Anthropic as a test-and-compare layer.
- Claude Max/Team plans grant monthly Claude API credits ($100 on Max 5x, $200 on Max 20x, up to $500 pooled on Team) into a linked Console org. A Claude subscription itself never mints an API key.
- OpenRouter always returns `usage` including `cost`, even on the final streaming chunk. `GET /api/v1/key` returns `limit`, `limit_remaining` and daily usage.
- Command Code and OpenCode Zen issue API keys for their gateway. Command Code's Pro plan is $20/month for up to $110 of credits — the deepest discount supply available.
- Anthropic banned subscription OAuth tokens in third-party tools in writing (Feb 2026) and blocks them server-side (Jan 2026). OpenAI's Codex endpoint whitelists first-party originators. OpenCode removed its Anthropic OAuth plugin after legal requests, and users were banned.
- Hedera HIP-542: a transfer of HTS tokens to an EVM alias creates the account with that token associated, and the sender pays creation. `IDENTICAL_SCHEDULE_ALREADY_CREATED` returns the existing schedule id.
- Lightweight Charts v5 API as listed in §10.

---

## 13. What is NOT verified, and what is blocked

These are the things most likely to cost a day. Fix them before writing product code.

1. **0G inference returns 402 `insufficient_balance`.** All four keyed inference tests fail even though the vault is funded. The `sk-` key is valid on testnet but almost certainly belongs to a different 0G account. `OG_MK` is missing, so two more tests are skipped. **Fix:** create a fresh `sk-` while signed in as `0x3b03…04FA`, or deposit to the dashboard account.
2. **Hedera treasury has no USDC.** `0.0.11193715` holds 6.14 HBAR and 0 USDC. The Circle faucet never delivered, and the mirror shows no USDC transaction and no pending airdrop. **Hypothesis:** the account is not associated with USDC `0.0.429274`. **Fix:** submit `TokenAssociateTransaction` (about 0.66 HBAR), then re-request from the faucet, then rerun the Hedera tier — it switches to USDC automatically at ≥0.10.
3. **World keyed tests never ran.** They need app registrations (`WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`) and a person with the World App (`PREFLIGHT_HUMAN=1`).
4. **Whether 0G API keys spend iAI credits, and whether resale is allowed.** Only 0G can answer. Credits are "not redeemable for cash", which is exactly the thesis, but the API-key link is unproven.
5. **OAuth rails will be refused.** Anthropic blocks subscription tokens outside its own CLI; Codex's endpoint accepts first-party originators only. Expect 401/403 on the first request, which marks the listing `invalid`. They are in the plan because the decision was made, and they ship flag-gated.
6. **The settle-before-stream x402 path** exists in the API but has never been executed end to end. Add it to preflight.
7. **The `__probe__` key-validation trick** (a valid key plus an unknown model returns 404 rather than 401) is documented behaviour but untested.

---

## 14. Accounts and endpoints (testnet only — no secrets here)

| Thing | Value |
|---|---|
| Shared EVM address | `0x3b036A01D0785bE98A260e939dF4F1779DAf04FA` |
| Galileo balance | ~0.029 0G, plus 0.07 0G in the Payment Layer vault |
| Hedera treasury | `0.0.11193715` — 6.14 HBAR, 0 USDC, `max_automatic_token_associations = -1`, ECDSA key |
| Hedera USDC | `0.0.429274` |
| 0G Payment Layer | testnet `0x0AD9690e0b34aB2d493DE02cDF149ee34f6C9939`, mainnet `0xA3b15Bd2aD18BFB6b5f92D8AA9F444Dd59d1cE32` |
| x402 facilitators | `https://x402.org/facilitator` (fee payer `0.0.9185802`), `https://api.testnet.blocky402.com` (`0.0.7162784`). Ax402 is excluded — its fee account holds 4 HBAR. |
| World issuers | `https://auth.world.org`, sandbox `https://sandbox.auth.world.org`. IDKit verifies at `https://developer.world.org/api/v4/verify/{rp_id}`. |
| 0G models with real spread | `glm-5.3` $4.40–$6.60 per 1M output across 6 listings; `deepseek-v4-flash` $0.264 in / $0.792 out |

All keys live in `~/ethglobal-preflight/.env`, which is gitignored. Nothing in this document or the plan should ever contain a private key.

---

## 15. Where things live and how to run them

```
~/.opencode/plan/llm-token-exchange.md      the plan (spec)
~/.opencode/plan/llm-token-exchange-KT.md   this document
~/ethglobal-preflight/                      the preflight suite (not in the project repo)
    pnpm contracts        # build/verify the Cancun probe
    pnpm test:stack       # smoke the built Next app
    pnpm test             # all tiers; keyed tiers skip without env
    .env / .env.example   # every variable, with its source
```

The project repo does not exist yet, by design. First post-kickoff commit should include `docs/plan.md` (a copy of the plan) and the AI-usage section.

---

## 16. Build order

| # | Milestone | Done when |
|---|---|---|
| M0 | Bootstrap | Vercel deploy, Neon migrated, forge builds, preflight green |
| M1 | Router core | A seeded listing streams through the router; usage matches upstream tokens; a client abort leaves no `open` row |
| M2 | x402 top-up | Top-up creates and credits keys on Hedera; a replayed tx credits nothing |
| M3 | Auto top-up | An agent with $0 completes a request via 402 → pay → retry |
| M4 | Sellers | World verify, signed listing, per-rail probe, market and limit pricing, failover |
| M4b | Spot fills | `POST /trades` fills across two asks, writes prepaid, and a later request is served at charge 0 |
| M5 | Perps | Contracts deployed and tested; keeper posts the index from HCS; trade, funding, liquidation |
| M6 | Approvals | Human link and cap raise, including the denied path |
| M7 | Daily close | Scheduled payouts execute at 01:00; listings reset |
| M8 | Ship | `/receipts` recompute matches on-chain; video and READMEs done |
| M9 | Claude Code rail | OAuth callback activates a listing; translated usage is metered; refusal marks it invalid |
| M10 | Codex rail | Same, plus `chatgpt-account-id` and refresh |

M9 and M10 are 16–20 hours together and sit **outside** the 36-hour schedule. Fund them from the Wildcard extra, the `/receipts` polish and M6 — never from M1–M3 or M5.

---

## 17. Demo script

Seed with `scripts/seed.ts`: two 0G asks on the demo model, a small one 15% under reference and a larger one 3% under, a funded router key, a funded vault, MockUSDC for judges.

1. **0:00** — the problem: credits that expire and cannot be cashed out.
2. **0:20** — a seller lists: World verify, capped key, ask below list.
3. **0:45** — an agent with $0: request → 402 → USDC on Hedera → the answer streams. HashScan link on screen.
4. **1:15** — on `/trade`, buy MTokens. The book drains past the cheap ask, the minute VWAP jumps, the index steps. The agent then spends those tokens at charge 0.
5. **1:45** — on `/perps`, the index comes from the public log; go long on Galileo.
6. **2:10** — the agent hits its cap; World approval: deny, then approve.
7. **2:35** — `/receipts`: recompute the index from the public log in the browser.

Operational notes: keeper running at least 30 minutes before judging; `ENABLE_OAUTH_RAILS=0`; a fresh Hedera agent account created at least a minute before it pays.

---

## 18. Submission checklist

- **ETHGlobal:** steady commits, `docs/plan.md`, AI-usage section, video 2–4 min at ≥720p, no AI voiceover. OAuth rails are flagged off and therefore not part of the submitted product; API-key rails get one line.
- **0G:** live link, Galileo addresses, Telegram/X, video under 3 minutes, and evidence of credits spent plus 0G's share of venue volume. Wildcard extra (optional): archive the daily usage export to 0G Storage and register the root hash on Galileo.
- **Hedera:** README with settled top-up tx ids and HashScan links, architecture, payment flow, video under 5 minutes, list of extras used (spend caps, HCS log, USDC settlement, scheduled payouts).
- **World Agent Pass:** the full journey, the denied path, backend validation, and a debrief with time-to-first-success and the top friction point.
- **World IDKit:** the trust moment (one seller per human), why Proof of Human is the minimum credential, the alternative path, and a debrief.

---

## 19. Risks and open questions

| Risk | Impact | Mitigation |
|---|---|---|
| 36-hour schedule vs 12 milestones | M6–M10 slip | Cut order: Wildcard extra → `/receipts` polish → M9/M10 → M6 |
| 0G key/account mismatch unresolved | No inference at all | Fix before kickoff; test on mainnet at the event if needed |
| USDC never arrives on Hedera | x402 demo falls back to HBAR | Association first, then faucet; HBAR fallback is already proven |
| World sandbox app issuance takes ~1 hour | Approval demo blocked | Register in advance; fall back to mocked proofs if the event allows |
| OAuth rails refused | Two milestones dead | Flagged off; no dependency from the demo |
| Judges ask "why not just buy from OpenRouter?" | Weak pitch | The answer is the index, the perps, and agent payments — not the markup |
| ETHGlobal code-before-kickoff rule | Disqualification | Preflight stays outside the repo; no product code before kickoff |

Open questions for the providers: whether 0G API keys spend iAI credits and whether resale is acceptable; whether Command Code and Zen plan credits are usable through their API keys; whether OpenRouter's terms permit a marketplace routing traffic through seller keys.

---

## 20. Rejected alternatives (so nobody re-litigates them)

- **DeFi route** (0G + Uniswap + Chainlink, compute-claim tokens): a different project, weaker agent story, no x402 or World angle.
- **Selling subscription access** (Claude Pro/Max chat, ChatGPT plans): no API key exists, and both providers prohibit and block it. Their *API credits* are sellable and are already in the plan.
- **`withX402` for the chat route:** buffers the whole response, so SSE cannot pass through.
- **Per-model inventory on the buyer side** (the original design): replaced by prepaid tokens tied to a listing and an expiry, then by the fill model in decision 18.
- **A separate `/api/keys` login for agents:** there is no session; the bearer key is the credential and the first top-up creates it.
- **A `rollups` table:** the keeper reads the minute summaries back from Hedera's public log, so the perp price comes only from public data.
- **Per-top-up HCS receipts:** the USDC transfer is already public on Hedera.
- **A funding keeper job:** funding accrues on-chain whenever someone touches the market.
- **Gating perp trades with World:** the router cannot block an agent's own on-chain transactions. World gates what the router enforces: linking a human and raising a spend cap.
- **A Neon WebSocket driver for interactive transactions:** would add connection-lifecycle risk on Vercel; single atomic statements do the job.

---

## 21. How to resume in ten minutes

1. Read §1 and §5 of this document, then skim the plan's §1, §7, §9 and §14.
2. Open `~/ethglobal-preflight`, run `pnpm test` and see which tiers skip. Keys are in `.env`.
3. Do the two unblockers in §13: fix the 0G key, associate the Hedera treasury with USDC.
4. Register the World apps and set `PREFLIGHT_HUMAN=1`.
5. Add the two missing preflight checks: the settle-before-stream x402 path and the `__probe__` trick.
6. At kickoff, copy the plan into the repo as `docs/plan.md`, then start at M0.

---

## Appendix A — how the plan evolved

1. **v1:** single-rail 0G marketplace, USD balance, per-request metering, perps + keeper + HCS.
2. **v2 (bug pass):** atomic two-sided reservation, exactly-once settlement with an `open` usage row and a keeper sweep, time-to-first-byte timeout, oracle heartbeat shorter than staleness, first-post exemption, top-up retry settles the signed amount, payout account creation, settle clamps, crash-safe payouts, underwater close pays zero.
3. **v3 (rails):** eight rails, three protocols, reference price, price-free MToken, token metering, market asks restricted to expiring credits, per-rail probes, rail-aware resets.
4. **v4 (OAuth):** Claude Code and Codex rails, flagged off, with the provider refusal recorded as a known limit.
5. **v5 (pages + fills):** `/trade` and `/perps` replace `/m/[model]`; spot fills with prepaid MTokens; `INDEX_WINDOW_MIN` shrinks to 10 for the demo; the chart spec is pinned to Lightweight Charts v5.

## Appendix B — source files

| File | Contents |
|---|---|
| `~/.opencode/plan/llm-token-exchange.md` | Full spec: types, schema, formulas, endpoints, contracts, milestones |
| `~/.opencode/plan/llm-token-exchange-KT.md` | This handoff |
| `~/ethglobal-preflight/tests/0g.test.ts` | 0G chain, router, streaming, trust mode, price ceiling |
| `~/ethglobal-preflight/tests/hedera.test.ts` | x402 settlements, HCS, scheduled payouts, USDC/HBAR switch |
| `~/ethglobal-preflight/tests/world.test.ts` | OIDC discovery, device flow, IDKit |
| `~/ethglobal-preflight/tests/x402.test.ts` | In-process facilitator: buffering, no charge on error, $1 cap |
| `~/ethglobal-preflight/tests/stack.test.ts` | Built-app smoke test |
| `~/ethglobal-preflight/.env.example` | Every variable, with where to get it |
