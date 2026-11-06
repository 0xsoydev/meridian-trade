# Handoff — Person B: Router and Money

**Event:** ETHGlobal Mumbai, 5–7 Nov 2026. **Deadline:** Sat 7 Nov, 09:00 IST.
**Your name:** ______________
**Read first:** the plan at `llm-token-exchange.md`, §7 (units and math), §8 (data model), §9 (router and steps), §10.3 (x402), §10.10 (spot fills).
**You own:** `apps/web/lib/{schema,db,rails,price,secrets,auth,x402}.ts` and the routes `/api/v1/{chat/completions,topup,trades,book,models,balance,keys/settings}`.

---

## 1. Your mission

You own the money path. Every request is reserved, streamed, settled exactly once, and charged the right amount. If your part is wrong, the demo either charges twice, leaks money, or hangs. If it is late, nobody else can test anything, because the schema is yours.

You are the first person with something to publish: the schema and the JSON shapes, at T+2.

You do not touch the pages, the contracts, or the seller and World routes.

---

## 2. First 30 minutes

1. Read the plan sections above.
2. Write `lib/schema.ts` and the migration. Freeze it. Post the column list in the team channel so A and D can code against it.
3. Confirm with D the two things you cannot invent: the rail keys they will seed (start with `0g`) and whether `ENABLE_OAUTH_RAILS` is `0` for now.
4. Check `.env` has `DATABASE_URL`, `SECRETS_KEY`, `OG_ROUTER_URL`, the facilitator URLs and `HEDERA_TREASURY_ID`.
5. Branch: `git switch -c feat/router`.

---

## 3. What you deliver, and when

| Hour | Deliverable | Why it matters |
|---|---|---|
| T+2 | Schema, migrations, `.env.example`, shared TypeScript types | A, C and D are blocked without it |
| T+8 | `lib/rails.ts` catalog + `lib/price.ts` with tests | The pricing rule everything else validates against |
| T+10 | `POST /chat/completions` non-stream through a seeded listing, settled | M1 |
| T+14 | Streaming with settle-exactly-once, failover across listings | M1 complete |
| T+18 | `POST /topup` (x402) and auto top-up | M2, M3 |
| T+22 | `POST /trades`, `GET /book`, prepaid consumption in the chat path | M4b, unblocks `/trade` |
| T+26 | Hardening: sweep contract with the keeper, error mapping, replay tests | Freeze |

Cut order if behind: drop prepaid (Buy becomes a balance top-up and `/trade` says so), then drop non-0G rails, then drop failover. Never cut settle-once.

---

## 4. Units and formulas

All money is `bigint` in USD micro. All token counts are `bigint`. JSON carries them as decimal strings. No floats anywhere in the money path.

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
| `parseUsdPerToken` | exact decimal string × 10^12, string math |
| `blended` | `(3*prompt + completion) / 4` |
| `reference` | enabled rail with the lowest blended price for the model |
| `mixedTokens` | `ceil((3*promptTokens + completionTokens) / 4)` |
| `charge` | `ceil(tokens * ask / 1e6)` |
| `sellerEarning` | `floor(charge * (10_000 - takeBps) / 10_000)` |
| `railCost` | `ceil((promptTokens*prompt + completionTokens*completion) / 1e6)`, display only |
| `marketPrice` | best limit ask, else `rail.resetPeriod === null ? null : floor(blended(ref) * 9 / 10)` |
| `estimatePromptTokens` | `ceil(utf8Bytes / 3)` |
| `reservation` | `{ tokens: mixedTokens(estimatePromptTokens(bytes), maxTokens), micro: charge(tokens, ask) }` |

A 1,000-prompt / 1,000-completion request is 1,000 mixed tokens. At an ask of $1.50 per MTok that is $0.0015.

Missing usage — client abort, upstream break, deadline abort — falls back to `mixedTokens(estimatePromptTokens(bytes), ceil(forwardedCompletionBytes / 4))`, capped at the reservation.

---

## 5. Schema (yours to write, everyone else reads it)

| Table | Key columns |
|---|---|
| `sellers` | `id`, `address` unique lowercase, `world_nullifier` unique, `hedera_account` null |
| `listings` | `id`, `seller_id`, `rail`, `model`, `auth_kind` (`key`/`oauth`), `credential_ciphertext`, `account_ref`, `price_micro_per_mtok` null, `capacity_tokens`, `used_tokens`, `reserved_tokens`, `throttled_until`, `status`, `client_nonce` unique |
| `keys` | `id`, `hash` unique (SHA-256 of the key), `balance_usd_micro`, `reserved_usd_micro`, `auto_topup_usd_micro`, `daily_topup_cap_usd_micro`, `default_model`, `world_sub` |
| `topups` | `tx_id` primary key, `key_id`, `amount_usd_micro`, `payer` |
| `usage` | `id`, `status` (`open`/`settled`/`released`), `rail`, `upstream_request_id` unique when not null, `key_id`, `listing_id`, `prepaid_id` null, `price_micro_per_mtok`, `reserved_tokens`, `reserved_usd_micro`, token counts, `list_cost_usd_micro`, `mixed_tokens`, `charge_usd_micro`, `seller_earning_usd_micro`, `payout_id`, `hcs_minute`, `created_at`, `settled_at` |
| `trades` | `id`, `key_id`, `listing_id`, `model`, `tokens`, `price_micro_per_mtok`, `charge_usd_micro`, `seller_earning_usd_micro`, `payout_id`, `created_at` |
| `prepaid` | `id`, `key_id`, `listing_id`, `model`, `tokens_remaining`, `expires_at` |
| `payouts` | `id`, `seller_id`, `day`, `amount_usd_micro`, `schedule_id`, `status`, unique `(seller_id, day)` |
| `approvals` | `id`, `key_id`, `kind`, `cap_usd_micro`, `device_code_ciphertext`, `user_code`, `verification_uri_complete`, `interval_s`, `expires_at`, `status` |

Constraints that do real work: `used_tokens + reserved_tokens <= capacity_tokens`, `balance_usd_micro >= 0`, `reserved_usd_micro >= 0`, `tokens_remaining >= 0`. Keep them; the clamps in §7 depend on them.

**The driver has no interactive transactions.** `neon-http` cannot do `db.transaction()`. Every money write is one statement: a conditional `UPDATE … RETURNING`, or one CTE. When a statement touches several tables, lock in the order **usage → listing → key**.

`lib/secrets.ts` is AES-256-GCM with a 32-byte key from `SECRETS_KEY`: `seal(plain)` and `open(sealed)`. D uses it for seller credentials and device codes.

---

## 6. The endpoints you own

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/chat/completions` | `Bearer rk_` | OpenAI-compatible request; optional `model` falls back to `default_model` |
| POST | `/api/v1/topup?usd=` | none creates a key, bearer credits one | x402; bounds 0.10–20.00 |
| POST | `/api/v1/trades` | bearer | spot fill, §10.10 |
| GET | `/api/v1/book?model=` | none | asks + last 50 fills |
| GET | `/api/v1/models` | none | `{ object: "list", data: ModelRow[] }` with `rails`, `verifiability`, reference, best ask, index |
| GET | `/api/v1/balance` | bearer | balance, reserved, topped up today, cap, auto top-up, default model, `human_linked` |
| PATCH | `/api/v1/keys/settings` | bearer | auto top-up, daily cap (403 when raising it needs approval), default model |
| POST | `/api/v1/keys` | wallet signature | creates a key bound to the account, optionally with a World proof |
| GET | `/api/v1/keys` | wallet signature (query) | that account's keys and balances |
| POST | `/api/v1/keys/deposit` | bearer | verifies a USDC transfer on the mirror and credits the key once |

Error shape, always:

```ts
export type RouterError = {
  error: {
    message: string;
    type: "invalid_request_error" | "authentication_error" | "payment_error" | "permission_error" | "server_error";
    code: "invalid_api_key" | "model_not_found" | "no_liquidity" | "insufficient_balance" | "approval_required" | "upstream_failed" | "invalid_request";
  };
  approval?: ApprovalStart;
};
```

---

## 7. The chat path, step by step

1. Hash the bearer, load the key. Unknown → 401 `invalid_api_key`.
2. Validate the body with zod. `model ??= key.default_model`, else 400.
3. `catalog()` per rail, cached 300 s. `reference(model)`; unknown → 404 `model_not_found`.
4. `maxTokens = clamp(request ?? 4096, 1, model.max_completion_tokens)`. Force it into the upstream body. If streaming, force `stream_options.include_usage`.
5. If `PAYMENT-SIGNATURE` is present, run the top-up settle path first, with bounds 1 micro up to the remaining daily cap.
6. Candidates: active listings for the model on enabled rails, `throttled_until` null or past. Listings where this key holds unexpired prepaid tokens come **first**, FIFO by expiry; the rest are ordered by effective ask computed in code (`price ?? marketPrice(...)`) and capped at three.
7. Reserve in one statement, or nothing:
   - prepaid path: `prepaid.tokens_remaining -= r.tokens where tokens_remaining >= r.tokens`. No USD hold, no capacity change — the fill took both.
   - spot path: lock the listing when `status = 'active'` and capacity allows; `balance -= r.micro, reserved += r.micro where balance >= r.micro`; then `reserved_tokens += r.tokens`.
   - insert the `open` usage row only if one path reserved. Prepaid rows record `charge = 0`.
   - Listing side fails → next candidate. Key side fails → step 8. No candidate → 404 `no_liquidity`.
8. Short of money: `auto_topup = 0` → 402 `insufficient_balance`. Otherwise amount = `max(auto_topup, r.micro - balance)`; if that would exceed today's cap → 403 `approval_required` and create a `raise_cap` approval. Else return an x402 402 for that amount.
9. Upstream, per the candidate's rail: credential from `open()` or `lib/oauth.ts`; body forwarded for `openai-chat`, translated for the other two; 0G headers added only on the 0G rail. Timeout 120 s **until response headers**, abort on client disconnect, abort at `maxDuration - 20 s` (280 s).
10. Status before the first byte: 401/403 → listing `invalid`; 402 → `exhausted`; 429 → `throttled_until = now + (retry-after || 60s)`; 5xx, 529 or a header timeout → next candidate; 400/404 → return mapped. Always release the reservation first.
11. Non-stream: translate if needed, settle in a `finally`, return the OpenAI shape.
12. Stream: forward bytes untouched for `openai-chat`; translate events for the other two. Settle in a `finally` that runs on normal end, upstream error, client cancel **and** the deadline. A `TransformStream`'s `flush` alone never runs on cancel, which is why the usage row exists from step 7.

Settlement, one statement, effective once:

- `usage open → settled` guarded by `where status = 'open'`, with final fields and `settled_at = now()`.
- listing: `reserved_tokens -= r.tokens`, `used_tokens = least(used_tokens + actualTokens, capacity_tokens - (reserved_tokens - r.tokens))`, exhausted at capacity.
- key: `reserved -= r.micro`, `balance = greatest(balance + r.micro - charge, 0)`.
- listing and key change only if the usage row was still `open`.

Release is the same statement with zero usage, closing the row as `released`, and it gives back whichever hold was taken: prepaid tokens for a prepaid request, both reserved amounts for a spot one.

The clamps are not optional: if actual cost exceeds the reservation, a plain update violates a constraint and the row gets stuck open.

---

## 8. x402

```ts
export function resourceServer(): Promise<x402ResourceServer>;
export function paymentRequired(amountMicro: bigint, resourceUrl: string): Promise<{ status: 402; headers: Headers; body: string }>;
export function settleTopup(header: string, bounds: { minMicro: bigint; maxMicro: bigint }, resourceUrl: string): Promise<{ txId: string; payer: string; amountMicro: bigint } | { error: string }>;
```

- One `x402ResourceServer` per instance, registered with the two facilitator clients and `ExactHederaScheme`, `initialize()` once. Requirements carry the first healthy facilitator's fee payer, and a signed payment cannot fail over mid-flight.
- `paymentRequired` builds requirements for the treasury and encodes them into the `PAYMENT-REQUIRED` header.
- `settleTopup` decodes the header, takes `accepted.amount` as an integer string, rejects it outside `bounds`, rebuilds the requirements **with the same builder used for the 402**, then matches, verifies and settles. Never re-derive the amount from state that may have changed.
- Credit with one CTE that inserts into `topups` and only updates the key if the insert returned a row. A replayed tx id credits nothing.
- Top-up without a bearer creates the key and returns the plaintext once — that is how an agent signs itself up.
- Respond with `PAYMENT-RESPONSE` via `encodePaymentResponseHeader`.

Recheck the daily cap at settlement, not only when quoting the 402.

---

## 9. Gotchas

- `withX402` buffers the whole response. That is why this path is manual.
- The browser paywall has no Hedera build. Agents and the CLI pay; the UI shows an instruction, not a payment button.
- `maxDuration = 300` on the chat route. Anything still streaming at 280 s is aborted and settled from the fallback.
- The x402 client default cap is $1 per payment. A request whose worst case exceeds that will be refused client-side; keep `max_tokens` sane.
- `@x402/next` is not used here. `@x402/core` and `@x402/hedera` are enough.
- A failed candidate's reservation must be released before trying the next one, otherwise capacity leaks until the sweep.
- Two listings can be throttled by the same provider; the third candidate is there for that.

---

## 10. Definition of done

- A seeded listing streams an answer through `/api/v1/chat/completions`.
- `usage` matches the upstream token counts, and the key balance moved by exactly the charge.
- Killing the client mid-stream leaves no `open` row after 6 minutes, and the hold is back.
- An agent with $0 goes 402 → pays → retries → streams, with a HashScan link.
- Replaying the same settlement tx credits nothing.
- A prepaid request settles at `charge = 0` and does not touch listing capacity.
- `lib/price.test.ts` passes.

## 11. Do not touch

`contracts/**`, `keeper/**`, `apps/web/app/**` (pages), `/api/sellers`, `/api/listings`, `/api/approvals`, `/api/oauth`, `agents/**`, `scripts/**`.

## 12. Your part in the demo

At 0:45 the agent pays; you watch the facilitator and settlement logs. At 1:15 `/trade` fills; you watch the balance and the `trades` row land. If anything 500s, you will be the one reading the log, so keep `apps/web` running locally with the Vercel logs open.
