# LLM Token Exchange — Implementation Plan (ETHGlobal Mumbai, Nov 5–7 2026)

Planning artifact. ETHGlobal Classic track: no project code before kickoff. This document fixes types, interfaces, schemas and formulas; function bodies are written after kickoff. Commit this file as `docs/plan.md` in the first commit and disclose AI assistance in the README.

Submission deadline: Sat Nov 7 2026, 09:00 IST. Partner prizes: 0G (Build with iAI + Wildcard), Hedera (AI Agents That Pay: x402), World (Agent Pass + IDKit).

---

## 1. Product

- Sellers list unused LLM capacity as MTokens at a limit price or at market. Capacity comes from a **rail**: a provider credential the seller owns — 0G iAI credits, Anthropic or OpenAI API credits, a gateway key (OpenRouter, Command Code, OpenCode Zen), or a subscription OAuth login (§1.1, §10.9).
- Buyers (people and their agents) hold a USD balance on a router key and call our OpenAI-compatible router. They can also buy MTokens up front at the best asks (§10.10); a request is served from prepaid MTokens when they cover it, otherwise bought at the cheapest ask across rails. Seller credentials never leave the server.
- Optional auto top-up: when a request cannot be covered, the router answers with an x402 `402`; the buyer's x402 client pays in USDC on Hedera and retries automatically. Daily cap enforced server-side; raising it needs fresh World ID approval.
- Perps: cash-settled USDC perps on the venue's $/MToken index, on 0G Galileo. Sellers short to lock in tomorrow's revenue; buyers long to cap costs.
- Revenue: take rate on spot fills (`TAKE_BPS`, default 1000) and perp fees (10 bps of notional).

Supply is worth selling because the credits expire and cannot be cashed out: 0G iAI resets daily, Claude Max and Team plans grant monthly API credits, gateway plans grant monthly allowances. That is why a below-list ask is rational, and why a rail with plain API credits adds coverage rather than discount.

Rules fixed by tests or by the user:

| Rule | Source |
|---|---|
| Ask must be at or below the blended list price of the listing's own rail | user |
| Market asks fill at the best limit ask; the 90%-of-reference fallback applies only to rails with expiring credits | plan |
| One MToken = 1M mixed tokens (3 input : 1 output), price-free; capacity and usage are token counts | plan |
| A request is served entirely from prepaid MTokens or entirely at the current ask, never a mix | plan |
| A spot fill takes the seller's capacity for that period and the prepaid MTokens expire with it; no refund | plan |
| Metering uses the rail's reported token counts, never a rail's cost field | plan |
| Subscription OAuth rails (Claude Code, Codex) run only when `ENABLE_OAUTH_RAILS=1` | user |
| x402 payments are `exact` scheme, USDC on Hedera; client default cap $1 per payment | preflight |
| `withX402` buffers responses, so the router settles top-ups itself before streaming | preflight |
| New Hedera accounts need ~2 s on the mirror node before paying | preflight |
| 0G keys support `credit_limit`, `reset_period: daily`, `allowed_models`, `trust_mode` | 0G API reference |
| Galileo supports Cancun opcodes; deploy ≈ 128k gas, price post ≈ 44k gas | preflight |
| Browser x402 paywall has no Hedera build; buyers pay from agents/CLI | package inspection |

### 1.1 Rails

Every seller credential is one rail instance. Rails are static config in `lib/rails.ts`; adding a provider is one entry, not one module.

```ts
export type RailId = "0g" | "anthropic" | "openai" | "openrouter" | "commandcode" | "zen" | "claude-code" | "codex";

export type RailModel = { canonical: string; upstream: string; listPrompt: bigint; listCompletion: bigint };

export type Rail = {
  id: RailId;
  protocol: "openai-chat" | "anthropic-messages" | "openai-responses";
  baseUrl: string;
  auth: "key" | "oauth";
  extraHeaders: Record<string, string>;
  models: ReadonlyArray<RailModel>;
  resetPeriod: "daily" | "monthly" | null;
  enabled: boolean;
};
```

| Rail | Protocol | Base URL | Auth | Notes |
|---|---|---|---|---|
| `0g` | openai-chat | `OG_ROUTER_URL` | key | trust and max-price headers; models and prices from `OG_MODELS_URL`, 0G's public mainnet `/models`, so a testnet router without providers does not delist 0G markets; credits reset daily |
| `anthropic` | openai-chat | `ANTHROPIC_BASE_URL` (default `https://api.anthropic.com/v1`) | key | Anthropic's OpenAI-compatible layer; Console workspace key; Max/Team API credits are monthly; prices seeded as USD per MTok in `rails.ts`; no catalog request |
| `openai` | openai-chat | `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) | key | project key with a budget; `maxTokensField: max_completion_tokens`; prices seeded as USD per MTok; no catalog request |
| `openrouter` | openai-chat | `https://openrouter.ai/api/v1` | key | prices from `/models`; `GET /api/v1/key` returns remaining credits; no expiry |
| `commandcode` | openai-chat | `COMMANDCODE_BASE_URL` (default `https://api.commandcode.ai/provider/v1`) | key | prices seeded at provider rates; `maxTokensField: max_completion_tokens`; Claude is `/messages`-only and excluded; the Go plan has no API access |
| `zen` | openai-chat | `ZEN_BASE_URL` (default `https://opencode.ai/inference/openai/v1`) | key | Console translates every text model to OpenAI-chat, so Claude works here; prices seeded; `maxTokensField: max_tokens`; no expiry |
| `opencode-go` | openai-chat | `OPENCODE_GO_BASE_URL` (default `https://opencode.ai/inference/go/openai/v1`) | key | monthly per-model dollar allowance; single-member workspace; traffic monitored for abuse |
| `claude-code` | anthropic-messages | `https://api.anthropic.com/v1` | oauth | §10.9, flagged off |
| `codex` | openai-responses | `https://chatgpt.com/backend-api/codex` | oauth | §10.9, flagged off |

`catalog()` in `lib/rails.ts` fetches `/models` for 0G and OpenRouter (300 s cache). 0G prices come from `pricing_usd`; `pricing` is a scaled integer and must not be used. Model ids are per rail: 0G sends bare ids, OpenRouter namespaced ones, so each rail carries its own upstream id for a canonical model. `resetPeriod` drives two things: capacity reset (`daily` only) and whether a listing may post a market ask (any non-null period, because expiring credits make a below-list ask rational).

---

## 2. Sponsor surface

| Sponsor | What judges must see | Where |
|---|---|---|
| 0G | Credits spent by our app; inference on 0G Compute funded by them (request ids); daily return loop; Galileo contract addresses; live link; video < 3 min | Router metering, `/receipts`, README |
| 0G Wildcard | 0G Compute request id, 0G Storage root hash, 0G Chain contract | Optional daily ledger archive (§20) |
| Hedera | x402 endpoint settling on Hedera; agent paying with no human; README with settled tx ids + HashScan; video ≤ 5 min. Extras: spend controls, HCS audit log, USDC settlement, scheduled payouts | `/api/v1/topup`, `/api/v1/chat/completions`, keeper |
| World Agent Pass | Verification request → completion → validated result → protected action; denied/expired path; backend validation; debrief | Raising the auto top-up cap; linking an agent to its human |
| World IDKit | Trust moment with minimum sufficient credential; server verify; alternative path; debrief | Seller onboarding: one seller per human, proof bound to wallet |

0G is the only rail in the demo and the only one named in the submission: it is the verifiable rail and the expiring-credit story. API-key gateways are product depth. OAuth rails are flag-gated and excluded (§21).

---

## 3. System

```
                    ┌──────────────── apps/web (Next.js 16, Vercel) ──────────────┐
 Seller ─Privy────► │ UI: / · /trade · /perps · /sell · /keys · /receipts         │
                    │                                                             │
 Agent ───────────► │ /api/v1/chat/completions ── reserve ─► seller rail (§1.1)   │
 OpenAI SDK +       │        │ 402 x402 ◄─ auto top-up ─► facilitator ─► Hedera     │
 @x402/fetch        │ /api/v1/topup ─────────────── x402 ─► facilitator ─► Hedera   │
                    │ /api/v1/approvals ─────────── device flow ─► World ID issuer │
                    │ /api/sellers/* ── IDKit verify ─► developer.world.org         │
                    └──────────────────────────┬──────────────────────────────────┘
                                               │ Neon Postgres (drizzle, neon-http)
 keeper (Node 22) ────────────────────────────┼─► HCS: per-minute fill rollups
                                               ├─► Galileo IndexOracle.post
                                               ├─► Galileo PerpMarket.liquidate
                                               └─► Hedera scheduled payouts 00:00 UTC
 Trader ─Privy/wagmi─► PerpMarket (Galileo, MockUSDC margin)
```

---

## 4. Repository

```
apps/web/
  app/page.tsx
  app/(site)/layout.tsx
  app/(site)/trade/page.tsx
  app/(site)/perps/page.tsx
  app/(site)/sell/page.tsx
  app/(site)/keys/page.tsx
  app/(site)/receipts/page.tsx
  app/providers.tsx
  app/api/v1/chat/completions/route.ts
  app/api/v1/topup/route.ts
  app/api/v1/models/route.ts
  app/api/v1/balance/route.ts
  app/api/v1/keys/settings/route.ts
  app/api/v1/trades/route.ts
  app/api/v1/book/route.ts
  app/api/v1/approvals/route.ts
  app/api/v1/approvals/[id]/route.ts
  app/api/sellers/rp-signature/route.ts
  app/api/sellers/verify/route.ts
  app/api/oauth/[rail]/start/route.ts
  app/api/oauth/[rail]/callback/route.ts
  app/api/listings/route.ts
  app/api/listings/[id]/route.ts
  lib/db.ts
  lib/schema.ts
  lib/price.ts
  lib/price.test.ts
  lib/rails.ts
  lib/translate.ts
  lib/translate.test.ts
  lib/oauth.ts
  lib/x402.ts
  lib/world.ts
  lib/secrets.ts
  lib/auth.ts
  lib/chain.ts
contracts/
  foundry.toml
  src/IndexOracle.sol
  src/PerpMarket.sol
  src/MockUSDC.sol
  test/PerpMarket.t.sol
  script/Deploy.s.sol
keeper/main.ts
agents/demo/main.ts
scripts/seed.ts
docs/plan.md
```

`lib/*` are plain function modules, one per external system. No classes, services, repositories or DI.

---

## 5. Stack (exact pins, all verified by preflight)

| Area | Packages |
|---|---|
| App | next 16.4.3, react 19.3.1, react-dom 19.3.1, typescript 7.0.2, @types/node 22 |
| UI | tailwindcss 4.3.3, @tailwindcss/postcss 4.3.3, shadcn 4.23.0 (CLI), lightweight-charts 5.2.1, qrcode 1.5.4 |
| Wallet | @privy-io/react-auth 3.51.0, @privy-io/wagmi 4.0.19, wagmi 3.7.9, viem 2.57.5, @tanstack/react-query 5.105.0 |
| Payments | @x402/core 2.28.0, @x402/fetch 2.28.0, @x402/hedera 2.28.0, @hiero-ledger/sdk 2.85.0 |
| Identity | openid-client 6.8.8, @worldcoin/idkit 4.6.0, @worldcoin/idkit-core 4.6.0 |
| Data | drizzle-orm 0.45.4, drizzle-kit 0.31.11, @neondatabase/serverless 1.2.0, zod 4.6.7 |
| Agent | openai 7.45.0 |
| Contracts | Foundry 1.5.1, solc 0.8.30, evm_version cancun, @openzeppelin/contracts 5.6.1 |

`@hiero-ledger/sdk` stays at 2.85.0 to match `@x402/hedera`; import `PrivateKey`, `Client`, `TransferTransaction` from `@x402/hedera` where possible. Rails and OAuth need no new package: `node:crypto` covers PKCE, and every rail is plain `fetch`.

---

## 6. Coding rules

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`; external data enters as `unknown` and leaves zod.
- zod at every trust boundary: request bodies, query params, upstream responses (0G, Anthropic, OpenAI, gateways), World responses, facilitator responses.
- Money and token counts are `bigint` end to end (USDC micro = 1e-6 USD; tokens = integer). No floats in money paths. JSON carries bigints as decimal strings.
- No comments in code. Deliberate limits live in §21.
- No abstractions without two real callers. Route handlers call `lib` functions directly.
- Rails are static config in `lib/rails.ts`; no per-provider classes, no adapter interface. Adding a provider is one entry.
- Translators (`lib/translate.ts`) are pure functions from `unknown` to zod-validated types, fixture-tested, and never compute money.
- Seller credentials — API keys and OAuth token sets — are sealed with AES-256-GCM and opened only inside the request that uses them. OAuth refresh is deduped per listing in-process.
- Every balance or capacity change is one SQL statement (conditional `UPDATE … RETURNING` or a CTE). neon-http has no interactive transactions; single statements are atomic. A statement that touches several tables locks existing rows in the order usage → listing → key.
- Router errors use the OpenAI shape `{ error: { message, type, code } }`.
- Never store or log prompts or completions. Only metadata.
- One runnable check per non-trivial logic: `lib/price.test.ts` and `lib/translate.test.ts` (node:test with recorded fixtures), `contracts/test/PerpMarket.t.sol` (forge).

---

## 7. Units and math (`lib/price.ts`)

All prices are USD micro per 1M tokens (`MicroPerMTok`, bigint). Prompt and completion prices come from the rail's catalog (§1.1); 0G and OpenRouter publish them as USD per token decimal strings.

```ts
export type Micro = bigint;
export type MicroPerMTok = bigint;
export type Pricing = { prompt: MicroPerMTok; completion: MicroPerMTok };

export function parseUsdPerToken(decimal: string): MicroPerMTok;
export function blended(p: Pricing): MicroPerMTok;
export function reference(model: string): { railId: RailId; pricing: Pricing } | null;
export function mixedTokens(promptTokens: bigint, completionTokens: bigint): bigint;
export function charge(tokens: bigint, ask: MicroPerMTok): Micro;
export function sellerEarning(chargeMicro: Micro, takeBps: bigint): Micro;
export function railCost(p: Pricing, promptTokens: bigint, completionTokens: bigint): Micro;
export function marketPrice(bestLimitAsk: MicroPerMTok | null, ref: Pricing, rail: Rail): MicroPerMTok | null;
export function estimatePromptTokens(utf8Bytes: number): bigint;
export function reservation(ask: MicroPerMTok, utf8Bytes: number, maxTokens: bigint): { tokens: bigint; micro: Micro };
```

| Function | Formula |
|---|---|
| `parseUsdPerToken` | exact decimal string × 10^12 (string math, no floats) |
| `blended` | `(3·prompt + completion) / 4` |
| `reference` | the enabled rail with the lowest `blended` for that model |
| `mixedTokens` | `ceil((3·promptTokens + completionTokens) / 4)` |
| `charge` | `ceil(tokens · ask / 1e6)` |
| `sellerEarning` | `floor(charge · (10_000 − takeBps) / 10_000)` |
| `railCost` | `ceil((promptTokens·prompt + completionTokens·completion) / 1e6)` — display only |
| `marketPrice` | `bestLimitAsk ?? (rail.resetPeriod === null ? null : floor(blended(ref) · 9 / 10))` |
| `estimatePromptTokens` | `ceil(utf8Bytes / 3)` |
| `reservation` | `{ tokens: mixedTokens(estimatePromptTokens(bytes), maxTokens), micro: charge(tokens, ask) }` |

Example: GLM-5.3 list $1.40 / $4.40 → reference blended $2.15 = 2_150_000. Ask $1.50 = 1_500_000. A 1 000-prompt / 1 000-completion request is 1 000 mixed tokens and costs $0.0015.

Listing validation: `price === null || price <= blended(railPricing(rail, model)!)`; `price === null` requires `rail.resetPeriod !== null`. The router still takes the cheapest ask across rails, so the venue's best price is what buyers compare.

Missing usage (client abort, upstream break, deadline abort): `mixedTokens(estimatePromptTokens(bytes), ceil(forwardedCompletionBytes / 4))`, capped at the reservation.

`lib/price.test.ts` asserts: the GLM-5.3 example; `marketPrice` returns `null` on a rail with `resetPeriod = null` and no asks; rounding never makes `sellerEarning + platform > charge`; `mixedTokens` is monotonic in both arguments; reservation ≥ actual for a fixed sample.

---

## 8. Data model (`lib/schema.ts`, Postgres)

| Table | Columns | Constraints |
|---|---|---|
| `accounts` | `id uuid pk`, `address text`, `world_nullifier numeric(78,0) null`, `created_at` | `address` unique (lowercase), `world_nullifier` unique |
| `sellers` | `id uuid pk`, `address text`, `world_nullifier numeric(78,0)`, `hedera_account text null`, `created_at timestamptz` | `address` unique (lowercase), `world_nullifier` unique |
| `listings` | `id uuid pk`, `seller_id fk`, `rail text`, `model text`, `auth_kind text`, `credential_ciphertext text`, `account_ref text null`, `price_micro_per_mtok bigint null`, `capacity_tokens bigint`, `used_tokens bigint default 0`, `reserved_tokens bigint default 0`, `throttled_until timestamptz null`, `status text`, `reset_on date` (default today, UTC), `client_nonce text`, `created_at` | `capacity_tokens > 0`; `used_tokens + reserved_tokens <= capacity_tokens`; `auth_kind in ('key','oauth')`; `status in ('active','exhausted','invalid','cancelled','pending_auth')`; `client_nonce` unique; index `(model, status, price_micro_per_mtok)` |
| `keys` | `id uuid pk`, `account_id fk null`, `hash bytea`, `balance_usd_micro bigint`, `reserved_usd_micro bigint default 0`, `auto_topup_usd_micro bigint default 0`, `daily_topup_cap_usd_micro bigint default 5000000`, `default_model text null`, `world_sub text null`, `created_at` | `hash` unique; `balance_usd_micro >= 0`; `reserved_usd_micro >= 0` |
| `topups` | `tx_id text pk`, `key_id fk`, `amount_usd_micro bigint`, `payer text`, `created_at` | index `(key_id, created_at)` |
| `usage` | `id uuid pk`, `status text`, `rail text`, `upstream_request_id text null`, `key_id fk`, `listing_id fk`, `prepaid_id fk null` (set when the request spends prepaid MTokens), `price_micro_per_mtok bigint`, `reserved_tokens bigint`, `reserved_usd_micro bigint`, `prompt_tokens int default 0`, `completion_tokens int default 0`, `list_cost_usd_micro bigint default 0`, `mixed_tokens bigint default 0`, `charge_usd_micro bigint default 0`, `seller_earning_usd_micro bigint default 0`, `payout_id uuid null`, `hcs_minute bigint null`, `created_at`, `settled_at timestamptz null` | `status in ('open','settled','released')`; `upstream_request_id` unique when not null; index `(status, created_at)`, `(settled_at)`, `(listing_id, payout_id)` |
| `trades` | `id uuid pk`, `key_id fk`, `listing_id fk`, `model text`, `tokens bigint`, `price_micro_per_mtok bigint`, `charge_usd_micro bigint`, `seller_earning_usd_micro bigint`, `payout_id uuid null`, `seller_key_id uuid null` (set on resale), `created_at` | `tokens > 0`; index `(created_at)`, `(listing_id, payout_id)`, `(key_id, created_at)`, `(seller_key_id, created_at)` |
| `offers` | `id uuid pk`, `key_id fk`, `prepaid_id fk`, `listing_id fk`, `model text`, `price_micro_per_mtok bigint`, `tokens bigint` (unfilled), `expires_at timestamptz null`, `status text`, `created_at` | `status in ('open','filled','cancelled')`; `price > 0`; `tokens >= 0`; index `(model, status, price)`, `(key_id, status)` |
| `prepaid` | `id uuid pk`, `key_id fk`, `listing_id fk`, `model text`, `tokens_remaining bigint`, `expires_at timestamptz null`, `created_at` | `tokens_remaining >= 0`; index `(key_id, model, expires_at)` |
| `bids` | `id uuid pk`, `key_id fk`, `model text`, `price_micro_per_mtok bigint`, `tokens bigint` (unfilled), `hold_usd_micro bigint`, `status text`, `created_at` | `status in ('open','filled','cancelled')`; `price > 0`; `tokens, hold >= 0`; index `(model, status, price)`, `(key_id, status)` |
| `payouts` | `id uuid pk`, `seller_id fk`, `day date`, `amount_usd_micro bigint`, `schedule_id text null`, `execute_at timestamptz null`, `status text`, `created_at` | unique `(seller_id, day)`; `status in ('pending','scheduled','executed','cancelled')` |
| `perp_events` | `tx_hash text`, `log_index integer`, `account text` (lowercase), `model text`, `kind text`, `size bigint` (after the event), `margin bigint`, `price bigint`, `realized_pnl bigint`, `fee bigint`, `reward bigint`, `block bigint`, `at timestamptz` | pk `(tx_hash, log_index)`; `kind in ('modify','liquidate')`; index `(account, block)` |
| `approvals` | `id uuid pk`, `key_id fk`, `kind text`, `cap_usd_micro bigint null`, `device_code_ciphertext text`, `user_code text`, `verification_uri_complete text`, `interval_s int`, `expires_at`, `status text`, `created_at` | `kind in ('link_human','raise_cap')`; `status in ('pending','approved','denied','expired')` |
| `comfy_agents` | `key_id uuid pk fk → keys on delete cascade`, `agent text`, `created_at` | one comfy agent name per router key; written only when the key has a verified human |

Each request attempt writes one `usage` row: `open` at reservation, then closed exactly once as `settled` or `released` (§9, 11a). A `trades` row is a spot fill: capacity taken, money moved, a price observed. A request covered from prepaid writes a `usage` row with `charge_usd_micro = 0` and leaves listing capacity alone, because the fill already took it.

Router keys: `rk_` + 32 random bytes base64url; stored as SHA-256. Seller credentials (API keys and OAuth token sets) and device codes: AES-256-GCM with `SECRETS_KEY` (`lib/secrets.ts`: `seal(plain: string): string`, `open(sealed: string): string`).

---

## 9. Router API (`apps/web/app/api/v1`)

```ts
export type RouterError = {
  error: {
    message: string;
    type: "invalid_request_error" | "authentication_error" | "payment_error" | "permission_error" | "server_error";
    code:
      | "invalid_api_key"
      | "model_not_found"
      | "no_liquidity"
      | "insufficient_balance"
      | "approval_required"
      | "upstream_failed"
      | "invalid_request";
  };
  approval?: ApprovalStart;
};

export type ApprovalStart = {
  approval_id: string;
  user_code: string;
  verification_uri_complete: string;
  expires_at: string;
};

export type ModelRow = {
  id: string;
  object: "model";
  rails: RailId[];
  verifiability: "TeeML" | "TeeTLS" | null;
  list_prompt_micro_per_mtok: string;
  list_completion_micro_per_mtok: string;
  reference_blended_micro_per_mtok: string;
  list_ceiling_micro_per_mtok: string;
  best_ask_micro_per_mtok: string | null;
  index_micro_per_mtok: string | null;
  available_tokens: string;
};

export type TopupResult = {
  key?: string;
  key_id: string;
  balance_usd_micro: string;
  tx_id: string;
};

export type Balance = {
  memo: string;
  treasury: string | null;
  balance_usd_micro: string;
  reserved_usd_micro: string;
  topped_up_today_usd_micro: string;
  daily_topup_cap_usd_micro: string;
  auto_topup_usd_micro: string;
  default_model: string | null;
  human_linked: boolean;
};

export type KeySettings = {
  auto_topup_usd_micro?: string;
  daily_topup_cap_usd_micro?: string;
  default_model?: string | null;
};

export type ApprovalStatus = { status: "pending" | "approved" | "denied" | "expired" };
```

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/v1/chat/completions` | `Bearer rk_` (+ `PAYMENT-SIGNATURE` on retry) | OpenAI chat request; `model` optional (falls back to `default_model`); `model: "cheapest:a,b,c"` tries the listed models cheapest live ask first, moves to the next model when every seller of one fails, and names the model that answered in `X-Router-Model` | 200 JSON or SSE passthrough | 401, 402, 403 `approval_required`, 404 `model_not_found`/`no_liquidity`, 502 |
| POST | `/api/v1/topup?usd=0.50` | none (creates key) or `Bearer rk_` | none | 200 `TopupResult` + `PAYMENT-RESPONSE` | 402 (x402), 400 |
| POST | `/api/v1/trades` | `Bearer rk_` | `{ model, tokens, limit_price_micro_per_mtok? }` | `{ fills: Trade[], bid: Bid \| null, prepaid_tokens }` | 402, 404 `no_liquidity`, 400 |
| GET | `/api/v1/bids?model=` | `Bearer rk_` | — | `{ data: Bid[] }`, the key's open bids | 401 |
| POST | `/api/v1/sells` | `Bearer rk_` | `{ model, tokens, limit_price_micro_per_mtok? }` | `{ fills: Trade[], offers: Offer[], holding_tokens }` | 400, 404 `no_liquidity`, 409 |
| GET | `/api/v1/offers?model=` | `Bearer rk_` | — | `{ data: Offer[] }`, the key's open resale asks | 401 |
| DELETE | `/api/v1/offers/:id` | `Bearer rk_` | — | `{ offer_id, status }` | 404 |
| GET | `/api/v1/holdings?model=` | `Bearer rk_` | — | `{ data: Holding[] }`, the sellable prepaid rows | 401 |
| GET | `/api/v1/fills` | `Bearer rk_` | — | `{ data: KeyFill[] }`, the key's last 100 buys and resales | 401 |
| GET | `/api/v1/usage` | `Bearer rk_` | — | `{ data: KeyUsage[] }`, the key's last 100 calls: model, rail, tokens, prepaid or balance, charge | 401 |
| GET | `/api/v1/status` | none | — | `VenueStatus`: each perp market's index and age, the keeper's latest post, payouts in flight, 24 h fills and open asks; CDN-cached 15 s | — |
| GET | `/api/v1/payouts?seller=0x…` | none | — | `{ network, unpaid_usd_micro, data }`, a seller's payouts and unpaid earnings | 400 |
| DELETE | `/api/v1/bids/:id` | `Bearer rk_` | — | `{ bid_id, status, balance_usd_micro }` | 404 |
| GET | `/api/v1/book?model=` | none | — | `{ asks, fills }` | 404 |
| GET | `/api/v1/perps/history?account=0x…` | none | — | `{ data: PerpFill[] }`, the account's last 100 perp trades and liquidations, newest first | 400 |
| GET | `/api/v1/models` | none | — | `{ object: "list", data: ModelRow[] }`, the OpenAI list shape | — |
| GET | `/api/v1/balance` | `Bearer rk_` | — | `Balance` | 401 |
| PATCH | `/api/v1/keys/settings` | `Bearer rk_` | `KeySettings` | `Balance` | 403 `approval_required` when raising the cap |
| POST | `/api/v1/approvals` | `Bearer rk_` | `{ kind: "link_human" }` | `ApprovalStart` | 401 |
| PUT | `/api/v1/agents/comfy` | `Bearer rk_` | `{ agent }`, 1–64 of `[A-Za-z0-9 _.-]`, self-declared comfy.fun agent name | `{ agent, verified_human: true }` | 400, 401, 403 `approval_required` until the key has a linked human |
| GET | `/api/v1/agents/comfy` | none | — | `{ data: [{ agent, since, requests, spent_usd_micro }] }`, newest 50 | — |
| GET | `/api/v1/approvals/:id` | `Bearer rk_` | — | `ApprovalStatus` | 404 |
| POST | `/api/oauth/:rail/start` | `Signed<ListingIntent>` | credential kind | `{ authorization_url }` | 400 rail disabled |
| GET | `/api/oauth/:rail/callback` | `state` | `code` | 302 to `/sell` | 400 bad state |
| GET | `/api/listings?seller=0x…` | — | — | `SellerListings` | 400 |
| PATCH | `/api/listings/:id` | `Signed<AmendIntent>` | `{ price_micro_per_mtok, capacity_mtok }` | 200 listing | 400/404/409 |
| DELETE | `/api/listings/:id` | `Signed<CancelIntent>` | — | 200 | 404/409 |
| POST | `/api/v1/keys` | wallet signature | `{ address, message, signature, world? }` | `CreateKeyResult` | 401, 409 |
| GET | `/api/v1/keys` | wallet signature (query) | — | `{ keys: KeySummary[] }` | 401 |
| POST | `/api/v1/keys/deposit` | `Bearer rk_` | `{ tx_id }`, a Hedera transaction id or an EVM hash | `DepositResult` | 400, 409 |

`export const maxDuration = 300` on the chat route (Vercel Fluid compute ceiling on Hobby). `topup` amount bounds: 0.10–20.00 USD.

### Chat request handling

1. Auth: hash bearer, load key. Missing/unknown → 401 `invalid_api_key`.
2. Validate body (zod: `messages` array, `stream?`, `max_tokens?`/`max_completion_tokens?`, passthrough rest). `model ??= key.default_model` else 400.
3. Catalog: `lib/rails.ts` `catalog()` (per-rail, 300 s cache) → `reference(model)`. Unknown model → 404 `model_not_found`.
4. `maxTokens = clamp(request ?? 4096, 1, model.max_completion_tokens)`; force it into the upstream body. If `stream`, force `stream_options.include_usage = true`.
5. If `PAYMENT-SIGNATURE` present → top-up settle path (§10.3) before continuing; bounds: 1 micro up to the remaining daily cap.
6. Candidates: active listings for `model` from enabled rails with `throttled_until` null or past. Listings where this key holds unexpired prepaid MTokens come first (FIFO by `expires_at`), including ones the seller has since cancelled, because those MTokens are sold and paid for; the rest are ordered by effective ask, computed in app code because it depends on the rail (`price ?? marketPrice(bestLimitAsk, reference, rail)`). No ask and no eligible market rail → 404 `no_liquidity`.
7. For each candidate, one statement reserves what the request needs, or nothing:
   - prepaid: if the key holds at least `r.tokens` unexpired MTokens on this listing, `prepaid.tokens_remaining -= r.tokens where tokens_remaining >= r.tokens`. No USD hold and no capacity change: the fill took both (§10.10).
   - otherwise: lock the listing (`for update`) when `status = 'active'` and `used + reserved + r.tokens <= capacity`; `balance -= r.micro, reserved += r.micro where balance >= r.micro`, only if the listing row was locked; then `reserved_tokens += r.tokens`.
   - then insert the `open` usage row, only if one of the two paths reserved. A prepaid request records `charge = 0`.
   - Returns `paid_from`, `usage_id`. Listing side fails → next candidate. Key side fails → step 8. None → 404 `no_liquidity`.
8. Insufficient balance: `auto_topup_usd_micro = 0` → 402 `insufficient_balance` (OpenAI shape). Else amount = `max(auto_topup, r.micro − balance)`; if `topped_up_today + amount > daily_cap` → 403 `approval_required` (creates `raise_cap` approval). Else 402 x402 PaymentRequired for `amount` (§10.3).
9. Upstream: build the request for the candidate's rail.
   - Credential: `key` rail → `open(credential_ciphertext)`; `oauth` rail → `lib/oauth.ts` `accessToken(listing)` (§10.9).
   - Body: `openai-chat` → the body with `model = rail upstream id`; `anthropic-messages` → `translate.chatToAnthropic(body)`; `openai-responses` → `translate.chatToResponses(body)`.
   - Headers: `rail.extraHeaders`, plus 0G's `X-0G-Provider-Trust-Mode: verified` and `X-0G-Provider-Max-Price-Usd-Prompt/Completion` = the rail's list price.
   - Timeout 120 s until response headers, abort on client disconnect, abort at the deadline (`maxDuration − 20 s` after the request arrived).
10. Upstream status before first byte: 401 → listing `invalid`, release, next candidate. 403 → `invalid` only when the body says `upgrade_required` or an authentication error; a content-policy or per-request refusal returns 400 and leaves the listing active. 402 → listing `exhausted`, release, next. 429 → `throttled_until = now + (retry-after || 60 s)`, release, next. 5xx/529/header timeout → release, next. 400/404 → release, return the upstream error mapped to the OpenAI shape.
11. Non-stream: `openai-chat` returns the upstream JSON unchanged; the two translated protocols map it with `translate.*ToChat`. Read `usage`, settle (11a) in a `finally` (abort → §7 fallback), return the OpenAI chat shape.
12. Stream: `openai-chat` forwards bytes untouched; `anthropic-messages` and `openai-responses` map their events to OpenAI chat chunks (`translate.*SseToChat`), which also yields the final usage. Settle (11a) in a `finally` that runs on normal end, upstream error, client cancel (which aborts upstream) and the deadline; a `TransformStream` `flush` alone never runs on cancel. Missing usage → §7 fallback.

11a. Settle, one CTE statement, effective once: usage `open → settled` (`where status = 'open'`) with final fields and `settled_at = now()`; listing `reserved_tokens -= r.tokens`, `used_tokens = least(used_tokens + actualTokens, capacity_tokens − (reserved_tokens − r.tokens))`, → `exhausted` when `used = capacity`; key `reserved -= r.micro`, `balance = greatest(balance + r.micro − charge, 0)`. A prepaid request leaves the listing alone and sets `prepaid.tokens_remaining = greatest(tokens_remaining + r.tokens − actualTokens, 0)`, so a request that runs past its byte-estimated reservation is deducted what it used. Listing, key and prepaid change only if the usage row was still `open`. The clamps stop constraints from failing when actual cost exceeds the reservation (§21). Release is the same statement with zero usage, closing the row as `released`, and it gives back whichever hold was taken: `prepaid.tokens_remaining` for a prepaid request, `reserved_usd_micro` and `reserved_tokens` for a spot one.

---

## 10. Flows

### 10.1 Seller onboarding (`/sell`)

1. Connect wallet (Privy, embedded or external).
2. `POST /api/sellers/rp-signature` → `signRequest({ signingKeyHex: WORLD_RP_SIGNING_KEY, action: "seller" })`.
3. `IDKitRequestWidget` with `proofOfHuman` preset, `signal = address` (lowercase), `environment = WORLD_ENV`.
4. `POST /api/sellers/verify` `{ address, signed, idkit }`: verify wallet signature (§10.6); assert `idkit.environment === WORLD_ENV`; forward to `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`; require `success === true`; insert seller with nullifier (`numeric(78,0)`). Duplicate nullifier → 409 (one seller per human). Cancel/failure → no row.
5. Rail picker, one line per rail with its capping story:
   - `0g`: create the key at pc.0g.ai with `allowed_models: [model]`, `trust_mode: verified`, `credit_limit = daily credits`, `reset_period: daily`.
   - `anthropic`: a Console workspace key with a workspace spend limit; Max and Team plans grant monthly API credits to a linked Console organisation.
   - `openai`: a project key with a budget.
   - `openrouter`, `commandcode`, `zen`: a key carrying the gateway's own spend limit.
   - `claude-code`, `codex`: the OAuth button (§10.9), visible only when `ENABLE_OAUTH_RAILS=1`.

### 10.2 Listing

```ts
export type ListingIntent = {
  action: "list";
  rail: RailId;
  model: string;
  capacity_mtok: string;
  price_micro_per_mtok: string | null;
  client_nonce: string;
};

export type Credential = { kind: "key"; key: string } | { kind: "stored"; listing_id: string } | { kind: "oauth" };
```

`POST /api/listings` `{ signed: Signed<ListingIntent>, credential: Credential }`:
1. Verify signature, seller exists, `rail.enabled`.
2. `own = railPricing(rail, model)`; missing → 404 `model_not_found`; `price === null || price <= blended(own)` else 400. `price === null` requires `rail.resetPeriod !== null` else 400.
3. Probe by rail, free of charge: `0g` → `POST /chat/completions` `{ model: "__probe__" }`, expect 404 `model_not_found`; `anthropic` and `openai` → `GET /models`; `openrouter` → `GET /api/v1/key` (also returns `limit_remaining`, shown as a capacity hint); gateways → `GET /models`. 401/403 → reject.
4. `kind: "key"` → insert with `status = 'active'`, `auth_kind = 'key'`, `credential_ciphertext = seal(key)`. `kind: "oauth"` → insert with `status = 'pending_auth'`, `auth_kind = 'oauth'`, and return `{ authorization_url }` from §10.9; the callback flips it to `active`.
5. `capacity_tokens = capacity_mtok × 1e6`. On OAuth rails capacity is advisory: the provider's window is the real limit and `throttled_until` is the only brake we control (§21).
6. `kind: "stored"` reuses the key sealed on one of the signer's own listings on the same rail: the server opens it, probes it for the new model like a pasted key, and seals it again on the new listing. Another seller's listing, another rail or an OAuth listing is a 404. The key never reaches the browser.

`GET /api/listings?seller=0x…` returns `SellerListings`: `verified` (a `sellers` row exists for the address) and that seller's listings, newest first, without credentials. `/trade`'s Sell tab reads it to find a stored key on a rail that serves the model.

`DELETE /api/listings/:id` with `Signed<{ action: "cancel"; listing_id: string; client_nonce: string }>` → `status = cancelled` when no reservation is open. MTokens already sold on it stay spendable (§9 step 6).

`PATCH /api/listings/:id` with `Signed<{ action: "amend"; listing_id: string; price_micro_per_mtok: string | null; capacity_mtok: string; client_nonce: string }>` → re-runs the price rule and updates both fields. `capacity_tokens` may not fall below `used_tokens + reserved_tokens`; shrinking to that floor is allowed. This is the Sell side of `/trade`.

### 10.3 Top-up (`lib/x402.ts`)

```ts
export function paymentRequired(amountMicro: bigint, resourceUrl: string): Promise<{ status: 402; headers: Headers; body: string }>;
export function settleTopup(header: string, bounds: { minMicro: bigint; maxMicro: bigint }, resourceUrl: string): Promise<{ txId: string; payer: string; amountMicro: bigint } | { error: string }>;
```

- One `x402ResourceServer(new HTTPFacilitatorClient({ url, timeoutMs: 20_000 })).register(HEDERA_NETWORK, new ExactHederaScheme())` per URL in `X402_FACILITATOR_URLS`, initialized once and cached. A facilitator that fails `initialize`, `verify` or `settle` is benched for 5 min. A 402 offer comes from the first facilitator that is not benched and initializes, and carries that facilitator's fee payer. The Hedera scheme matches `extra.feePayer` exactly, so only the facilitator that issued an offer can settle a payment made against it.
- `paymentRequired`: `buildPaymentRequirements({ scheme: "exact", network: HEDERA_NETWORK, payTo: HEDERA_TREASURY_ID, price: "$<amount>" })` → `createPaymentRequiredResponse(...)` → `encodePaymentRequiredHeader` into `PAYMENT-REQUIRED`.
- `settleTopup`: `decodePaymentSignatureHeader` → `accepted.amount` (zod: integer string; USDC atomic units = micro) must fall within `bounds` → for each facilitator, rebuild its requirements exactly as `paymentRequired` does for that amount → `findMatchingRequirements` → on the first match, `verifyPayment` → `settlePayment`. The retry never re-derives the amount from state that may have changed since the 402. Any failure → 402 with the reason.
- Credit, one statement: `with t as (insert into topups … on conflict (tx_id) do nothing returning amount_usd_micro) update keys set balance_usd_micro = balance_usd_micro + (select amount_usd_micro from t) where id = $key and exists (select 1 from t)`. A replayed tx id credits nothing.
- `/api/v1/topup` without auth: after settlement insert a new key, return the plaintext key once.
- Response header `PAYMENT-RESPONSE` via `encodePaymentResponseHeader`.

### 10.4 Human link and cap raise (`lib/approvals.ts`, World ID)

```ts
export function startApproval(keyId: string, kind: "link_human" | "raise_cap", capMicro: bigint | null): Promise<ApprovalStart>;
export function pollApproval(keyId: string, approvalId: string): Promise<ApprovalStatus | null>;
export function approveWithProof(approvalId: string, idkit: unknown): Promise<ApprovalOutcome>;
export function denyApproval(approvalId: string): Promise<boolean>;
```

- **Start:** `startApproval` stores a `pending` approval for 10 minutes with a six-character user code. It returns `verification_uri_complete = PUBLIC_HOST/approve/<id>`. A second `raise_cap` for the same cap returns the open approval instead of opening another.
- **The page:** `/approve/[id]` shows the kind, the cap and the code. It runs IDKit with `proofOfHuman`, the action `WORLD_APPROVAL_ACTION` and the approval id as the signal, using an RP signature from `/api/v1/approvals/:id/rp-signature`. The human approves with World App or denies.
- **Approve:** `POST /api/v1/approvals/:id/verify { idkit }` verifies the proof with World (`verifyWorld`, action and signal pinned), then:
  - `link_human` sets `keys.world_sub` to the proof's nullifier, and is refused when another human is already linked;
  - `raise_cap` requires the nullifier to equal `keys.world_sub`, then sets `daily_topup_cap_usd_micro = cap`.

  The row turns `approved` once.
- **Deny, expire, poll:** `POST /api/v1/approvals/:id/deny` sets `denied`. Past `expires_at`, the next read marks the row `expired`, and its protected action is never applied. The agent polls `GET /api/v1/approvals/:id` with its key every 3 s.
- **Bypass:** `NEXT_PUBLIC_WORLD_BYPASS=true` skips the proof outside production. The nullifier is then the key's linked one, or a per-key test value.
- Raising the cap without a linked human → 403 telling the client to link first.

### 10.5 Daily close (keeper, 00:00 UTC)

1. For every seller with unpaid money from before today — `usage` rows settled with a seller earning, plus `trades` rows that are not resales — one statement inserts the payout (`on conflict (seller_id, day) do nothing`, status `pending`) and sets `payout_id` on exactly the rows it sums.
2. Every `pending` payout, including any left by a crash:
   - Seller without `hedera_account`: look up `address` on the mirror; if absent, a plain `TransferTransaction` of 1 micro-USDC treasury → `AccountId.fromEvmAddress(0, 0, seller.address)` creates the account with USDC associated (HIP-542; treasury pays creation). Store the `0.0.N` id.
   - `ScheduleCreateTransaction` wrapping `TransferTransaction` USDC treasury → `seller.hedera_account`, `setExpirationTime(execute_at)`, `setWaitForExpiry(true)`, `setAdminKey(treasury)`, `setScheduleMemo(payout.id)`. The first attempt stores `execute_at = max(payout.day + 1 d at 01:00 UTC, now + 10 min)` with `coalesce`, so it is never overwritten: a payout closed late still pays ten minutes out, and every retry rebuilds the identical body and gets `IDENTICAL_SCHEDULE_ALREADY_CREATED` with the existing schedule id instead of a second transfer. A payout still `pending` after its `execute_at` is logged for an operator (§21). Store `schedule_id`, status `scheduled`.
3. Reset listings on rails with `resetPeriod = 'daily'` whose `reset_on` is before today: `used_tokens = 0, status = 'active', reset_on = today where status in ('active','exhausted')`. It runs every minute, at most once per listing per UTC day, so a keeper that was down at midnight resets on its next tick. Monthly and non-expiring rails keep their usage; the seller re-lists or raises capacity.
4. Until `execute_at` an operator can cancel a payout with `ScheduleDeleteTransaction`.
5. Every minute, for every `scheduled` payout: mirror `GET /schedules/{id}`, where a 404 means the mirror has not indexed it yet. `executed` only when `executed_timestamp` is set and `GET /transactions?timestamp=` holds a `scheduled` transaction with `result: SUCCESS`; deleted → `cancelled`; anything else stays `scheduled` and is re-checked every minute.

Schedules pay the numeric account id because resolving an EVM alias inside a scheduled transaction is unverified.

### 10.6 Wallet-signed mutations (`lib/auth.ts`)

```ts
export type Signed<T> = { address: `0x${string}`; message: string; signature: `0x${string}`; intent: T };
export function verifySigned<T>(s: Signed<T>, schema: z.ZodType<T>): Promise<T>;
export function routerKey(request: Request): Promise<KeyRow | null>;
```

`message = JSON.stringify({ domain: PUBLIC_HOST, issued_at, ...intent })`; viem `verifyMessage`; reject when `issued_at` is older than 300 s or the domain differs; replays blocked by `client_nonce` unique constraints.

### 10.7 Index pipeline (keeper)

1. Every 60 s, per model with fills in the previous minute — `trades` plus `usage` rows whose `charge_usd_micro > 0` — submit one HCS message. A minute that closes with fills wakes the post loop immediately.
2. When woken, or every 180 s, per market: read the last `INDEX_WINDOW_MIN` minutes of rollups for the model from the mirror node (`/topics/{HCS_TOPIC_ID}/messages`) — the public log is the only input. `INDEX_WINDOW_MIN` is 60 in production and 10 for the demo.
   - `twap` = mean `vwap` over minutes with fills.
   - No fills → effective best ask → else `marketPrice(null, reference, rail)`; `null` means the market has no bid.
   - `index = clamp(twap, blended(reference(model)!.pricing)/10, blended(reference(model)!.pricing))`. The floor sits at a tenth of list, so a deep spot discount moves the index instead of pinning it at half of list.
   - Post when `|Δ| ≥ 10 bps` or 5 min since last post (inside the 600 s staleness window): `IndexOracle.post(market, index, seqFrom, seqTo)`. Each post moves at most `MAX_MOVE_BPS` from the last posted price, so a large move converges over successive posts instead of reverting.
3. Every 30 s, scan at most 30 chunks of 2,000 blocks of `PositionModified` and `Liquidated` logs into `perp_events` (`on conflict do nothing`). A liquidation's price is the last `IndexPosted` for its market in the 2,000 blocks before it. A restart resumes after the last recorded block, with the recorded accounts already tracked. Then `canLiquidate` → `liquidate` for every tracked account.

```ts
export type Rollup = {
  v: 1;
  model: string;
  minute: number;
  fills: number;
  mixed_tokens: string;
  charge_usd_micro: string;
  vwap_micro_per_mtok: string;
  usage_root: string;
};
```

`vwap = Σ(price · mixed_tokens) / Σ mixed_tokens` over the minute's rows, each at the ask or bid it filled at; `charge_usd_micro` reports what was charged. Charges round up to whole micro-USD per request, so dividing them by tokens would overstate the VWAP of a minute of small requests. `usage_root` = SHA-256 Merkle root over `sha256(id|key_id|charge|mixed_tokens)` of that minute's rows. It commits to the rows; serving inclusion proofs is out of scope (§21). Message < 1024 bytes.

### 10.8 Perps (frontend)

Approve MockUSDC → `modify(market, sizeDelta, marginDelta)`. Position panel reads `positions` and `equity`; liquidation price shown client-side from the same formulas. Testnet faucet: `MockUSDC.mint` (cap 1,000 USDC per call).

- `orderPlan(current, delta)` in `lib/perp.ts` splits an order. An open or an add is one leg with `openMargin`, and a reduce or a close is one leg with no margin. An order that crosses zero, which the contract refuses with `FlipNotAllowed`, becomes a close and then an open of the rest, sent only after the close confirms. The button names the result: "Close 4 long, short 6 MTok".
- `positionAfter` previews the position an order leaves: funding settled, the fee, realized PnL on a reduce, the size-weighted entry on an add. The ticket shows that position's liquidation price.
- Positions rows carry leverage (`notional / equity`) and an inline margin editor: `modify(market, 0, ±amount)`, removal capped at `equity − notional / maxLeverage` and at the settled margin.
- Trade History reads `/api/v1/perps/history`: time, market, size change, price, realized PnL, fee, and liquidations with the margin lost and the liquidator's reward.
- A stale index on a market with no ask reads "no spot price for this model yet", because the keeper has nothing to post.

### 10.9 Subscription OAuth rails (`lib/oauth.ts`)

```ts
export function startUrl(rail: Rail, listingId: string): Promise<string>;
export function complete(rail: Rail, code: string, state: string): Promise<void>;
export function accessToken(listing: ListingRow): Promise<string>;
```

1. `startUrl`: PKCE S256 with `node:crypto`; `state = seal({ listing_id, nonce, exp })`; scope `user:inference user:profile` for `claude-code`, the Codex client scope for `codex`. Client ids are the vendors' own published CLI clients, read at implementation time (§21).
2. `complete`: verify `state`, reject a reused `nonce`, exchange the code for `{ access, refresh, expires_at, account_id }`, store the set sealed in `credential_ciphertext`, `account_ref = account_id`, `status = 'active'`.
3. `accessToken`: return the cached access token while it lives > 60 s; otherwise refresh, re-seal and update. An in-process `Map<listingId, Promise<string>>` dedupes concurrent refreshes; a cross-instance race loses one refresh and that request fails over.
4. Request shape: `claude-code` speaks `anthropic-messages`; `codex` speaks `openai-responses` and adds `chatgpt-account-id: <account_ref>`.
5. Refusal is terminal for the attempt, not a retry loop: 401/403 marks the listing `invalid` per §9 step 10.

### 10.10 Spot fills and prepaid MTokens (`/trade`)

```ts
export type TradeIntent = { model: string; tokens: string };
export type Trade = { listing_id: string; tokens: string; price_micro_per_mtok: string; charge_usd_micro: string };
export function buy(keyId: string, intent: TradeIntent): Promise<{ fills: Trade[] }>;
```

1. Validate: `tokens > 0` within the per-trade cap, `reference(model)` exists, and the key's balance covers the whole fill — otherwise the same 402 as §9 step 8.
2. Walk the asks cheapest first, skipping listings throttled into the future, until `tokens` are filled. One statement per listing: lock it, take `min(left, capacity − used − reserved)` of capacity into `used_tokens`, insert the `trades` row at that listing's ask, and debit the buyer's balance. A listing that fails mid-walk loses only its own slice.
3. Credit the fill as a `prepaid` row per listing: `tokens_remaining = take`, `expires_at` = the end of that rail's period — next 00:00 UTC for `resetPeriod = 'daily'`, `null` otherwise.
4. The seller is paid at fill time through `trades.seller_earning`, which the nightly payout includes (§10.5).
5. Requests spend prepaid first (§9 step 6). A request is served entirely from prepaid or entirely at the current ask, never a mix, so `charge = 0` is an unambiguous marker and the VWAP stays exact.
6. Prepaid MTokens expire with the period they were bought for and are not refunded: the capacity was set aside and the seller was paid. That is the same expiring-credit logic that makes below-list asks rational.

`GET /api/v1/book?model=` returns the asks (`listing_id`, rail, price, tokens left, verifiable), the open bids summed by price (best first, at most 20 levels) and the last 50 `trades`, which is what `/trade` renders and what its live series reads.

Limit buys (`lib/bids.ts`):
1. `limit_price_micro_per_mtok` stops the ask walk at the first ask above it. What the walk fills is charged as above; the rest rests as a `bids` row. One statement moves `hold = charge(rest, limit)` from the key's balance into the bid, or rests nothing when the balance cannot cover it. The 402 check covers the fills plus that hold. A limit above the highest list price among the enabled rails that serve the model (`list_ceiling_micro_per_mtok` on `/api/v1/models`) is refused with 400, because no ask can sit above list.
2. A bid always holds exactly `charge(tokens, price)` for its unfilled tokens. A fill of `take` tokens charges `hold − charge(tokens − take, price)` and the bid keeps the new `charge(tokens − take, price)`, so a bid's fills add up to what it held, and a full fill leaves 0.
3. `matchBids(model)` fills the best bid (highest price, then oldest) from the best ask while the ask is at or below the bid, one statement per fill that locks the bid and the listing, and stops at the first fill that fails. The trade prints at the bid's price: the resting order sets the price, so sellers selling into bids print below the asks and the tape moves both ways. Fills write `trades` and `prepaid` like a buy, and the seller is paid at the trade's charge.
4. Matching runs after `POST /api/listings` and `PATCH /api/listings/:id`, and every 60 s in the keeper, which also catches capacity returned by the daily reset.
5. `DELETE /api/v1/bids/:id` cancels an open bid of the calling key and returns its hold to the balance in one statement. Bids stay open until filled or cancelled; a key may fill its own bid.

Resale (`lib/offers.ts`, `POST /api/v1/sells { model, tokens, limit_price_micro_per_mtok? }`): a key sells MTokens it holds. Each move is one statement that locks every row it changes, and a key never trades with its own bid or offer.
1. **What can be sold:** unexpired prepaid rows on listings that still serve (`active`, `exhausted` or `cancelled`), soonest expiry first. Selling more than that holds is a 400, and a limit above the list ceiling is a 400 as for buys.
2. **Into a bid:** the best bid at or above the limit (any bid on a market sell) takes `min(left, bid, prepaid row)`. The bid pays `hold − charge(tokens − take, price)` as in a bid fill. The seller's key gets that charge less the venue fee, and the bidder receives a prepaid row with the seller's listing and expiry. The trade prints with `seller_key_id`.
3. **The rest of a limit sell:** escrowed as `offers` rows (prepaid → offer, with the same listing and expiry), at the limit, one per prepaid row it drew from. Inference cannot spend escrowed MTokens, because it reserves from `prepaid` only. Nothing rests on a market sell; a market sell into no bids is a 404.
4. **Buying from an offer:** `POST /api/v1/trades` walks listing asks and other keys' unexpired offers together, by price, then age. An offer fill charges the buyer at the offer price, credits the seller's key less the fee, and hands over a prepaid row on the offer's listing and expiry. The book shows offers as asks with `kind: "resale"`.
5. **Cancel:** `DELETE /api/v1/offers/:id` returns an offer's remaining MTokens to the prepaid row they came from.
6. **Proceeds:** resale proceeds go to the seller's key balance. The provider was paid at the first fill, so `closeDay` skips trades with a `seller_key_id`.

### 10.11 Human signup and deposit (`/api/v1/keys`)

```ts
export type CreateKeyResult = { key: string; key_id: string };
export type KeySummary = { key_id: string; balance_usd_micro: string; created_at: string };
export type DepositResult = { tx_id: string; amount_usd_micro: string; balance_usd_micro: string };
```

1. `POST /api/v1/keys` `{ address, message, signature, world? }`. The message is JSON `{ domain, action: "create_key", issued_at }`; `domain` must equal `PUBLIC_HOST` or the request `Host`; `issued_at` must be within 5 minutes; viem `verifyMessage`. A malformed signature is a 401, never a 500.
2. If `world` is present, `verifyWorld` posts it to `${WORLD_VERIFY_URL}/${WORLD_RP_ID}` and requires `success: true` and a numeric nullifier. Without `WORLD_RP_ID` a supplied proof is rejected; accounts created without one stay unverified.
3. `ensureAccount` upserts on the lowercase address; a second address presenting the same nullifier is a 409.
4. A key is created with zero balance and `account_id`; the plaintext is returned once.
5. `GET /api/v1/keys?address&message&signature` with `action: "list_keys"` returns that account's keys, balances and creation times.
6. `POST /api/v1/keys/deposit` `{ tx_id }` with a bearer key: normalise the id to `0.0.x-seconds-nanos`, fetch `{MIRROR_NODE_URL}/api/v1/transactions/{id}` (v1; there is no v2 path), require `result: SUCCESS`, `memo_base64` decoding to the key id, and a positive USDC transfer to the treasury. Credit exactly what arrived, at most `TOPUP_MAX_MICRO`; `topups.tx_id` makes a replay a 409. `GET /api/v1/balance` returns that memo (the key id) and the treasury account, so the deposit panel can show both. An EVM hash (`0x` and 64 hex) takes the wallet path instead: the key must belong to a wallet account; fetch `{MIRROR_NODE_URL}/api/v1/contracts/results/{hash}`, require the returned `hash` to equal the input and `result: SUCCESS`, then credit the sum of the USDC `Transfer` logs from that wallet to the treasury's `evm_address` on the mirror. That address is the treasury's alias when it has one: HTS refuses a transfer to the long-zero form of an aliased account with `INVALID_ALIAS_KEY`. The lowercased hash is the `topups.tx_id`. The balance also carries `treasury_evm`, `usdc_evm` (the token's long-zero address) and the key's `wallet`, which the browser needs to pay.

---

## 11. Contracts (Galileo, `contracts/`)

```solidity
interface IIndexOracle {
    event IndexPosted(bytes32 indexed market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo);
    error PriceMoveTooLarge();
    error NotKeeper();
    function post(bytes32 market, uint256 priceMicroPerMTok, uint64 hcsSeqFrom, uint64 hcsSeqTo) external;
    function latest(bytes32 market) external view returns (uint256 priceMicroPerMTok, uint64 updatedAt);
    function setKeeper(address keeper) external;
}

interface IPerpMarket {
    struct Market {
        uint256 maxLeverage;
        uint256 maxOiTokens;
        int256 fundingK;
        uint256 longOi;
        uint256 shortOi;
        int256 cumFunding;
        uint64 lastAccrual;
        bool listed;
    }

    struct Position {
        int256 size;
        uint256 margin;
        uint256 entryPrice;
        int256 entryCumFunding;
    }

    event MarketListed(bytes32 indexed market, uint256 maxLeverage, uint256 maxOiTokens, int256 fundingK);
    event PositionModified(address indexed account, bytes32 indexed market, int256 size, uint256 margin, uint256 price, int256 realizedPnl, uint256 fee);
    event Liquidated(address indexed account, bytes32 indexed market, address indexed liquidator, uint256 reward);
    event VaultFunded(uint256 amount);

    error MarketUnknown();
    error StalePrice();
    error FlipNotAllowed();
    error OiCapExceeded();
    error InsufficientMargin();
    error NotLiquidatable();
    error VaultInsufficient();

    function listMarket(bytes32 market, uint256 maxLeverage, uint256 maxOiTokens, int256 fundingK) external;
    function fundVault(uint256 amount) external;
    function modify(bytes32 market, int256 sizeDelta, int256 marginDelta) external;
    function liquidate(address account, bytes32 market) external;
    function positions(address account, bytes32 market) external view returns (Position memory);
    function equity(address account, bytes32 market) external view returns (int256);
    function canLiquidate(address account, bytes32 market) external view returns (bool);
}
```

Base contracts: OZ `Ownable`, `ReentrancyGuardTransient`, `SafeERC20`. `market = keccak256(bytes(modelId))`.

Units: price = USDC micro per MTok (6 dp); size = tokens (int256, 1 MTok = 1e6); `cumFunding` = USDC micro per MTok × 1e18.

| Quantity | Formula |
|---|---|
| notional | `abs(size) · price / 1e6` |
| pnl | `size · (price − entryPrice) / 1e6` |
| funding rate / s | `clamp(fundingK · (longOi − shortOi) / max(longOi + shortOi, 1e6), −fundingK, fundingK)` |
| accrual | `cumFunding += rate · (now − lastAccrual) · price` on every `modify`/`liquidate` |
| funding owed | `size · (cumFunding − entryCumFunding) / (1e18 · 1e6)` (positive = trader pays) |
| equity | `margin + pnl − fundingOwed` |
| fee | `ceil(abs(sizeDelta) · price / 1e6 · FEE_BPS / 10_000)` → treasury |
| initial margin | after modify with `size ≠ 0`: `equity · maxLeverage ≥ notional` |
| maintenance | liquidatable when `equity · 10_000 < notional · MM_BPS` |
| liquidation reward | `min(max(equity, 0), notional · LIQ_BPS / 10_000)` → liquidator; rest of equity → vault |

`modify` rules:
- Accrue funding; read oracle; `now − updatedAt > 600` → `StalePrice`.
- Increase or open: settle funding owed into margin, weighted-average `entryPrice`, `entryCumFunding = cumFunding`.
- Reduce: realize `pnl` on the reduced part into margin; entry unchanged.
- Crossing zero → `FlipNotAllowed`.
- Close to zero: transfer `max(equity, 0)` to the trader, delete position.
- `marginDelta > 0` pulls USDC; `< 0` sends USDC, then initial-margin check.
- OI per side ≤ `maxOiTokens` → else `OiCapExceeded`.
- Trader gains are paid from `vault` (`VaultInsufficient` if short); losses and funding paid go to `vault`.

Parameters: `MAX_LEVERAGE = 5`, `MM_BPS = 500`, `FEE_BPS = 10`, `LIQ_BPS = 50`, `fundingK` = 0.1%/hour at full skew, oracle `MAX_MOVE_BPS = 1000` (not applied to a market's first post), staleness 600 s.

`MockUSDC`: ERC-20, 6 decimals, public `mint(to, amount)` capped at 1,000e6.

`test/PerpMarket.t.sol`: long/short PnL; fee to treasury; funding sign and magnitude after warp; initial-margin rejection; liquidation boundary and reward; stale oracle revert; flip revert; OI cap; vault insufficient; oracle move guard and first post; underwater close pays the trader 0.

`script/Deploy.s.sol`: deploy MockUSDC, IndexOracle(keeper), PerpMarket(usdc, oracle, treasury); list `glm-5.3` and `deepseek-v4.1-flash`; fund vault 50,000 USDC. The demo model's market, `0gm-1.0-35b-a3b`, is listed by the seed.

---

## 12. Keeper (`keeper/main.ts`)

Single Node 22 process (`node --env-file=.env keeper/main.ts`). `setInterval` loops from §10.5 and §10.7, a 60 s `matchAllBids()` (§10.10), plus a 60 s sweep, `releaseStale()` from `apps/web/lib/ledger.ts`, that releases (§9, 11a) `open` usage rows older than 6 min, which exist only when a function died mid-request; each loop catches and logs its own errors and never overlaps itself. Holds `KEEPER_PRIVATE_KEY` (Galileo), `HEDERA_TREASURY_ID/KEY` (HCS, payouts). Idempotency: payouts `(seller_id, day)` unique and linked to their usage rows in the same statement; Hedera deduplicates identical schedules; HCS minute recorded in `usage.hcs_minute` after submit; oracle posts carry seq ranges; settle, release and sweep all require `status = 'open'`.

---

## 13. Demo agent (`agents/demo/main.ts`)

```ts
type AgentEnv = {
  ROUTER_URL: string;
  HEDERA_AGENT_ID: string;
  HEDERA_AGENT_KEY: string;
  GALILEO_AGENT_KEY: `0x${string}`;
  MODEL: string;
};
```

1. Signer: `createClientHederaSigner(HEDERA_AGENT_ID, PrivateKey.fromStringECDSA(HEDERA_AGENT_KEY), { network })`; `x402Client.fromConfig({ schemes: [{ network, client: new ExactHederaScheme(signer) }] })`; `pay = wrapFetchWithPayment(fetch, client)`.
2. `pay(ROUTER_URL + "/api/v1/topup?usd=0.50")` → router key.
3. `PATCH /keys/settings` → `auto_topup = 0.50`, cap 1.00.
4. `new OpenAI({ baseURL: ROUTER_URL + "/api/v1", apiKey, fetch: pay })`; stream a loop of tasks; auto top-ups happen inside `pay`.
5. Cap reached → 403 `approval_required`: print `verification_uri_complete`; poll `/approvals/:id`; retry after approval. Deny path printed when denied.
6. Hedge: viem wallet on Galileo → MockUSDC `mint`, `approve`, `PerpMarket.modify(market, +size, margin)`.
7. Print HashScan links for every top-up.

---

## 14. Frontend (`apps/web/app`)

| Page | Who | Contents | Data |
|---|---|---|---|
| `/` | everyone | Markets overview and the way in: model, rails, verifiability, best ask, index, discount, 24 h volume, links to `/trade?model=` and `/perps?model=` | DB + `IndexOracle.latest` |
| `/trade` | spot buyers and sellers | Model picker (`?model=`). **Buy**: the order book, asks with price, MTokens left, rail and verifiability and bids in green under them; size input; an optional limit price, where blank buys at market and a price fills what it can and rests the rest as a bid, with a note saying which will happen and a limit above the list price refused; fee, the amount held for the bid and the total; recent fills, charted as 1m, 5m, 15m or 1h candles from the last 50 fills; a short balance on a wallet key is paid from that wallet in Hedera USDC, up to 20 USD, before the buy. **Sell** is the same form for MTokens the key holds: what is available, size, an optional limit where blank sells into the bids now, best and average bid, fee, what rests as an ask and what you receive. A bottom panel holds:<br>• **Balances:** USD and holdings per model, rail and expiry.<br>• **Open Orders:** bids and resale asks with cancel; the connected seller wallet's provider asks with inline amend of price and capacity, and cancel, each wallet-signed.<br>• **Trade History:** the key's buys and resales.<br>• **Venue Fills** | `GET /api/v1/book`, `POST /api/v1/trades`, `POST /api/v1/sells`, holdings, bids, offers, fills, `PATCH`/`DELETE /api/listings/:id` |
| `/perps` | traders | Market picker (`?model=`, the listed perp markets only). Index chart and mark price, current funding rate, long/short with size, leverage and margin, flips as close then open, previewed liquidation price of the resulting position. Positions tab across all markets with leverage, margin add and remove, and close. Trade History tab. MockUSDC balance and faucet, connect-wallet state | `IndexPosted` logs (viem `getLogs`), `PerpMarket` reads, `/api/v1/perps/history`, wagmi |
| `/sell` | sellers, once | Wallet → World verify → source picker (API key, or a key already stored on one of the wallet's listings on that rail) → new listing → the wallet's listings with what is left, unpaid earnings, and payouts linked to their HashScan schedules. Setup and accounting; asks are amended and cancelled in Open Orders on `/trade` | `/api/listings`, `/api/v1/payouts` |
| `/keys` | a human buyer | Connect a wallet → sign once to create a router key → list keys, deposit panel (deposit from the key's wallet, or treasury, memo = key id, amount, tx id), balance, auto top-up, daily cap, default model, link human (QR via `qrcode`), and the key's usage history. Pasting an agent's key still works | `/api/v1/keys`, `/api/v1/keys/deposit`, `/api/v1/usage`, `/api/v1/*` |
| `/agents` | a comfy.fun agent's owner | four steps (Hedera wallet, copy the agent instructions for keyless x402 top-up, auto top-up, World ID link, comfy connect and `cheapest:` routing, approve with World ID, watch it work); the connected comfy agents with their verified human, requests and spend | `GET /api/v1/agents/comfy` data, read server-side |
| `/receipts` | judges | HCS rollups, top-ups (HashScan), index posts (chainscan), "recompute index" from mirror in the browser | mirror node, Galileo |

Charts use Lightweight Charts **v5**: series come from `chart.addSeries(LineSeries, …)` with the series types imported from the package, times are `UTCTimestamp` in seconds, new points go through `series.update()` (never `setData` on a tick — it resets the visible range), teardown is `chart.remove()`, and the chart renders client-only under Next.js. The v4 names (`addLineSeries`, `series.setMarkers`, the chart-level watermark option) do not exist in v5, and most examples online are v4. `/perps` plots two series: the on-chain index from `IndexPosted`, and the venue's per-minute VWAP from Hedera, polled every 15 s.

States the pages must cover, because the demo hits them:
- **Buy needs money first.** No browser x402 for Hedera, so `/trade` cannot take a payment: a short balance shows the exact amount needed and copies the agent top-up command.
- **Empty book** renders "no asks yet" with a link into the Sell form, not an error.
- **No wallet on `/perps`** hides the ticket until Galileo is connected.
- **Fee transparency**: ask, 10% take rate and total before submitting.
- **Risk next to the ticket**: liquidation price and margin ratio from the same formulas as §11.
- **Cold keeper**: before the first index post, "waiting for the first index post" instead of an empty chart.
- **Fill feedback**: a completed buy lists its fills and links each to the minute rollup on `/receipts`.

Not built: a mobile layout, an admin page (payout cancellation is an operator script), and a login page (Privy is a modal).

shadcn components: `table`, `card`, `button`, `input`, `select`, `dialog`, `tabs`, `badge`, `sonner`. `providers.tsx`: `PrivyProvider` (Galileo default chain) → `QueryClientProvider` → `WagmiProvider` (`@privy-io/wagmi` `createConfig`).

---

## 15. Environment

| Name | Used by | Value |
|---|---|---|
| `DATABASE_URL` | web, keeper | Neon |
| `SECRETS_KEY` | web, keeper | 32 bytes base64 |
| `PUBLIC_HOST` | web | deployed host |
| `OG_ROUTER_URL` | web, keeper | `https://router-api.0g.ai/v1` (dev: testnet URL) |
| `OG_MODELS_URL` | web, keeper | `https://router-api.0g.ai/v1/models` |
| `HEDERA_NETWORK` | web, keeper, agent | `hedera:testnet` |
| `HEDERA_TREASURY_ID`, `HEDERA_TREASURY_KEY` | web (payTo id only), keeper | ECDSA account associated with USDC |
| `HEDERA_USDC` | all | `0.0.429274` |
| `HCS_TOPIC_ID` | web, keeper | created once by setup script |
| `X402_FACILITATOR_URLS` | web | `https://api.testnet.blocky402.com,https://x402.org/facilitator` |
| `TAKE_BPS` | web, keeper | `1000` |
| `WORLD_ISSUER`, `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET` | web | Agent Pass app |
| `WORLD_ENV`, `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` | web | IDKit app |
| `NEXT_PUBLIC_PRIVY_APP_ID` | web | own app (deploy), 0G's (localhost demo) |
| `NEXT_PUBLIC_GALILEO_RPC`, `NEXT_PUBLIC_PERP_MARKET`, `NEXT_PUBLIC_INDEX_ORACLE`, `NEXT_PUBLIC_MOCK_USDC` | web | deploy output |
| `KEEPER_PRIVATE_KEY` | keeper | Galileo EOA |
| `MIRROR_NODE_URL` | web | `https://testnet.mirrornode.hedera.com` (a stub in tests) |
| `WORLD_VERIFY_URL` | web | `https://developer.world.org/api/v4/verify` (a stub in tests) |
| `ENABLE_OAUTH_RAILS` | web | `0`; `1` activates §10.9 |
| `OAUTH_REDIRECT_BASE` | web | deployed host, used for the callback URL |
| `CLAUDE_CODE_CLIENT_ID`, `OPENAI_OAUTH_CLIENT_ID` | web | the vendors' published CLI client ids, read at implementation time |
| `COMMANDCODE_BASE_URL`, `ZEN_BASE_URL` | web | from each provider's docs at kickoff |

---

## 16. Security checklist

- Seller credentials — API keys and OAuth token sets — sealed with AES-256-GCM; decrypted only inside the request that uses them. An OAuth set is account-scoped, so a leak is account takeover, not inference abuse: higher severity than an API key.
- Router keys stored as SHA-256; plaintext shown once.
- Upstream max-price headers pin 0G sellers to list price; seller keys on every rail are capped on the provider side.
- Balance and capacity reservations are conditional updates; constraints make negatives impossible; every reservation is closed exactly once.
- Top-up credit idempotent on settlement tx id.
- World approvals: one poll per request, `auth_time` freshness, `sub` match for cap raises.
- IDKit proofs bound to the seller wallet via `signal`; nullifier unique.
- Signed mutations: domain, 5-minute freshness, unique nonces.
- No prompts or completions persisted or logged.
- Human key creation needs a fresh wallet signature over `{domain, action, issued_at}`; a malformed signature is rejected, not thrown.
- Deposits are checked on the mirror: treasury credit, USDC asset, memo equal to the key id, successful result; `topups` turns a replay into a 409.
- A World nullifier is unique across accounts, and a proof is accepted only when `WORLD_RP_ID` is configured.
- Treasury and keeper keys only in server and keeper env.

---

## 17. Milestones and acceptance

| # | Milestone | Done when |
|---|---|---|
| M0 | Bootstrap | `apps/web` deploys to Vercel; Neon migrated; forge builds; preflight suite green |
| M1 | Router core | `rk_` key with manual balance streams GLM/0gm through a seeded listing; `usage` row matches the upstream token counts; balance and capacity exact; a client abort mid-stream leaves no `open` usage row |
| M2 | x402 top-up | `/topup` creates and credits keys on Hedera; replayed tx id credits nothing |
| M2b | Human signup | Wallet-signed key creation, key listing, and a USDC deposit credited from the mirror once; a replayed or mismatched transfer credits nothing |
| M3 | Auto top-up | Agent with $0 balance completes a streamed request via 402 → pay → retry; HashScan link printed |
| M4 | Sellers | IDKit verify, signed listing, key probe, market and limit pricing, failover on 401/402/429 |
| M4b | Spot fills | `POST /api/v1/trades` fills across two asks, debits the balance, writes `prepaid`, and a later request is served at charge 0; the fill enters the rollup and moves the index |
| M5 | Perps | Contracts deployed with tests green; keeper posts index from HCS; trade, funding, liquidation on Galileo |
| M6 | Approvals | Link human; cap raise approved and denied paths |
| M7 | Close | Scheduled payouts execute at 01:00 UTC; listings reset |
| M8 | Ship | `/receipts` recompute matches on-chain index; video, READMEs, debriefs |
| M9 | Claude Code rail | `claude-code` listing goes `pending_auth` → `active` through the OAuth callback; a stream is metered from the translated usage; a provider refusal marks it `invalid` on the first request |
| M10 | Codex rail | Same for `openai-responses`, including `chatgpt-account-id` and refresh |

---

## 18. Schedule (~36 h, kickoff → Sat 09:00 IST)

| Hours | Track A: contracts + keeper | Track B: router | Track C: frontend | Track D: agent + integration |
|---|---|---|---|---|
| 0–2 | M0 together | M0 | M0 | M0 |
| 2–8 | PerpMarket + tests | M1 non-stream → stream | `/`, `/trade`, `/perps` shells (model picker, static book) | Demo agent skeleton, accounts funded |
| 8–14 | Deploy Galileo, IndexOracle wiring | M2 | `/sell` + IDKit | HCS topic, mirror reads |
| 14–20 | Keeper rollups → index | M3, M4b, failover | Perp ticket + positions | M3 end to end with agent |
| 20–26 | Liquidations, daily close | M6 | `/keys`, `/receipts` | M4 with real 0G credits |
| 26–30 | M7 dry run | Hardening (§16) | Polish | Mainnet 0G run, links collected |
| 30–34 | Freeze | Freeze | Freeze | Video, READMEs, debriefs |
| 34–36 | Buffer | Buffer | Buffer | Submit |

Two people: A+C and B+D.

M9 and M10 sit outside this table: two OAuth flows and two protocol translators are roughly 16–20 h together. Fund them from the Wildcard extra, the `/receipts` polish and M6 — never from M1–M3 or M5.

---

## 19. Demo day runbook

- Vercel production with own Privy app; second instance `pnpm dev` on `localhost:3000` with 0G's Privy app id for the credit view.
- Keeper running ≥ 30 min before judging so the index has history.
- Seed with `scripts/seed.ts`: two 0G asks on the demo model — a small one 15% under reference and a larger one 3% under — plus a funded router key, vault funding and MockUSDC for judges. Re-running it is idempotent.
- Inference in the demo runs on Command Code `deepseek-v4.1-flash`, which needs a seller ask with capacity left. `0gm-1.0-35b-a3b` stays listed and tradeable, priced from 0G's public model list; show 0G inference only if the testnet router has a healthy 0gm provider that day.
- Agent terminal ready with a fresh Hedera agent account (created ≥ 1 min earlier).
- `ENABLE_OAUTH_RAILS=0` for the demo and the recording; only the 0G and (optionally) one API-key rail appear on stage.

Video (2:45–2:55, human voice): the shot list, lines, pre-flight checks and fallbacks are in [`docs/demo-script.md`](demo-script.md).
1. 0:00 Expiring credits problem.
2. 0:20 Seller lists: World verify, a stored key, an ask below list.
3. 0:45 Agent with $0 balance: request → 402 → USDC on Hedera → answer streams; HashScan link.
4. 1:10 On `/trade`: buy MTokens, resell part into a bid and list the rest; the agent spends what it holds at charge 0.
5. 1:40 On `/perps`: index from HCS rollups → long, add margin, flip short in one order, Trade History.
6. 2:05 Agent hits the cap → World approval: deny, then approve.
7. 2:30 `/receipts`: recompute index from the public log; an executed payout on HashScan.

---

## 20. Submission checklists

- ETHGlobal: steady commits; `docs/plan.md`; AI usage section; video 2–4 min at ≥ 720p; no AI voiceover. OAuth rails ship flagged off, so they are not part of the submitted product; API-key rails are product depth and get one line.
- 0G: name, description, repo, video < 3 min, live link, Galileo addresses, Telegram/X; show credits spent, 0G request ids, daily return loop, and the 0G share of venue volume. Wildcard (optional): upload the daily `usage` export to 0G Storage, store the root hash in a tiny registry contract on Galileo, add the one-sentence "what breaks without 0G".
- Hedera: README with settled top-up tx ids + HashScan links; architecture; payment flow; video ≤ 5 min; list extras used (spend caps + World approval, HCS log with usage roots, USDC settlement, scheduled payouts).
- World Agent Pass: journey + denied path + backend validation + debrief (time to first success, friction, missing docs, top improvement).
- World IDKit: trust moment (one seller per human), why Proof of Human is the minimum, alternative path, debrief.

---

## 21. Known limits

- The router holds seller credentials (custodial, AES-GCM). Upgrade: TEE-sealed keys.
- Rail catalogs:
  - 0G and Command Code list their models live; Command Code keeps only those that support `/chat/completions`.
  - OpenRouter lists its top 30 models by weekly tokens. The rankings endpoint needs `OPENROUTER_API_KEY`; without it the OpenRouter rail is off.
  - Anthropic, OpenAI, Zen and OpenCode Go only expose their model lists to a key holder, so `lib/rails.ts` keeps their chat-capable ids.
  - Prices come from the provider when its API publishes them (0G, OpenRouter). Otherwise they come from OpenRouter's live price for the same model, matched by the last id segment, lowercased, with Claude's `-5-5` read as `-5.5`. A model with no price is not listed.
- Each listing checks the seller's key against the exact model:
  - 0G: the free `__probe__` request.
  - OpenRouter: `/key`.
  - Command Code: one 1-token request.
  - Anthropic, OpenAI, Zen, OpenCode Go: the model must be in the key's own `/models` list.
- OpenCode Go requests carry a fresh `x-opencode-session` header.
- Seeded prices are the standard short-context tier. OpenAI doubles prices past 272K input tokens and Claude Haiku 5.5 is five times dearer past 100K, so a flat $/MTok listing priced at the short-context rate loses money on a very large prompt.
- Failover can move one request between rails with different upstreams and different verifiability. The buyer names a model, not a rail.
- Cash-denominated credits carry no discount incentive, which is why a rail with `resetPeriod = null` cannot post a market ask.
- Prompt tokens estimated as `bytes / 3` for reservations; when actual cost exceeds what the reservation plus balance covers, the platform absorbs the rest, and a prepaid request past what its prepaid row holds is served free. Upgrade: tokenizer per model.
- Reservations swept after a function died are released at zero charge.
- The daily cap is checked before settlement; concurrent top-ups can overshoot it by one top-up each.
- A payout needs the seller's Hedera account to be able to receive USDC. If the scheduled transfer fails at its `execute_at` (no balance, account not associated), the payout stays `scheduled`; the keeper re-checks it every minute and logs it for an operator.
- A keeper that is down at 00:00 UTC closes the day and resets daily listings on its first tick back; until then buyers see the previous day's exhausted capacity.
- After keeper downtime longer than `INDEX_WINDOW_MIN`, minutes older than the window are never published to HCS: the index ignores them and `/receipts` cannot show them.
- An older signed amend can be replayed inside its 5-minute window after a newer one: a listing keeps only its latest `client_nonce`.
- Each over-cap request starts its own approval; unanswered ones simply expire.
- Whoever completes an approval link first becomes the key's human (`link_human`); the link and its user code are bearer secrets until they expire.
- A payout still `pending` after its `execute_at` (Hedera kept refusing the schedule for ten minutes, or the keeper stopped between creating it and recording it) needs an operator: check the mirror for a schedule with that memo before clearing `execute_at` or paying by hand.
- `usage_root` inclusion proofs are not served.
- A signed payment settles only through the facilitator that offered it, so it cannot fail over mid-flight; the client retries for a fresh offer, which comes from a facilitator that is up.
- Keeper is a trusted poster; inputs are public and recomputable.
- House vault is the only counterparty; no LP shares.
- No per-key rate limiting beyond the rails' own.
- MockUSDC collateral on Galileo (no official stablecoin on testnet).
- Seller key caps on every rail are set on the provider side, not verified by us (a secret key cannot read its own limits); OpenRouter's `GET /api/v1/key` is the exception.
- Command Code sells no API access on its Go plan: sellers need GOAT, Pro, Max, Team or Provider, or every request returns `upgrade_required`.
- OpenCode Go is a single-member workspace with a monthly per-model dollar allowance (5h 20%, weekly 50%, monthly 100%) and monitored traffic; a listing there is rate-limited by allowance, not by the capacity the seller declared.
- The `maxTokensField` choice for the Command Code and Zen rails is unverified without a seller key; a wrong field shows up as a 400 on the first real request.
- A wallet deposit is credited only from the wallet that created the key. A memo deposit needs the transaction id pasted by hand, and a transfer without the key id as memo cannot be credited. An agent key without a wallet tops up with x402 or a memo deposit.
- One signature creates one key; there is no rotation or export after the plaintext is shown.
- A single deposit is capped at the same 20 USD ceiling as one x402 payment.
- OAuth rails are refused by the providers for third-party clients: Anthropic blocks subscription tokens outside its own CLI, and Codex's endpoint accepts first-party originators only. Expect 401/403 on the first request, which marks the listing `invalid`; a seller who connects one risks a ban on their personal account.
- OAuth capacity is advisory: the provider's window is the real limit, `429` sets `throttled_until`, and nothing reads remaining quota.
- OAuth refresh is deduped in-process only; a cross-instance race costs one request to failover.
- Monthly credits (Anthropic Max/Team, gateway plans) are not auto-reset: arrival days vary per plan, so capacity moves only when the seller re-lists.
- Anthropic's OpenAI-compatible layer silently ignores fields it does not implement (`response_format`, `strict`) and does not support prompt caching.
- `INDEX_WINDOW_MIN` is 10 minutes for the demo and 60 in production; a 60-minute average barely moves on one trade, which would leave the chart flat on stage.
- Prepaid MTokens expire with the seller's period and are not refunded: the capacity was set aside and the seller was paid at fill time.
- A spot fill walks the book in one statement per listing; a partially filled order is possible when capacity runs out mid-walk.

---

## 22. Before kickoff

1. Fix the 0G testnet key/account mismatch; rerun the preflight 0G tier.
2. Associate the Hedera treasury with USDC, request Circle faucet USDC, rerun the Hedera tier in USDC.
3. Ask 0G: do iAI credits appear as `credit_balance` and get spent by `sk-` keys? Is resale of credit-funded inference acceptable? Does `/v1/auth/privy` work from a third-party localhost app (one-click seller keys)?
4. World: sandbox World App via TestFlight (allow ~1 h issuance) or confirm mocked proofs for the event; register Agent Pass and IDKit apps.
5. Accounts: Privy app, Neon, Vercel; stock Galileo 0G from both faucets (index posts cost ≈ 0.13–0.25 0G/day across three markets).
6. Add preflight checks for the `__probe__` key validation, the settle-before-stream x402 path, a 1 micro-USDC transfer creating an account at a fresh EVM address, and a repeated `ScheduleCreate` returning `IDENTICAL_SCHEDULE_ALREADY_CREATED` with the first schedule id.
7. Probe both OAuth rails with throwaway accounts: start the flow, stream one request through the translator, confirm usage arrives, and record the exact refusal if there is one (§21).
8. Confirm each gateway's base URL and whether plan credits are usable through its API key: Command Code, OpenCode Zen, OpenRouter `limit_remaining`.
