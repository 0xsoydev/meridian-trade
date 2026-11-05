# Handoff — Person D: Supply, Identity and Demo

**Event:** ETHGlobal Mumbai, 5–7 Nov 2026. **Deadline:** Sat 7 Nov, 09:00 IST.
**Your name:** ______________
**Read first:** the plan at `llm-token-exchange.md`, §10.1 (seller onboarding), §10.2 (listing), §10.4 (World approvals), §10.9 (OAuth rails), §10.10 (fills), §13 (demo agent).
**You own:** `apps/web/app/api/sellers/**`, `apps/web/app/api/listings/**`, `apps/web/app/api/approvals/**`, `apps/web/app/api/oauth/**`, `apps/web/lib/world.ts`, `apps/web/lib/oauth.ts`, `agents/demo/**`, `scripts/seed.ts`, the READMEs and the runbook.

---

## 1. Your mission

You own the supply side and the demo. Sellers get verified, get a source connected, and get a listing live. A human can link to an agent and raise its spending cap. Then you make the whole thing repeatable: one seed script, one agent script, one rehearsed path.

You are also the team's unblocker. The 0G key, the Hedera USDC association and the World apps are yours to fix in the first hours, because three other people are waiting on them.

You do not touch the router's money path or the contracts.

---

## 2. First 30 minutes

1. Read the plan sections above.
2. **Unblock 0G:** the testnet key currently returns 402 `insufficient_balance` because it belongs to a different 0G account than the funded wallet `0x3b036A01D0785bE98A260e939dF4F1779DAf04FA`. Create a fresh `sk-` while signed in as that wallet, or deposit to the account the current key belongs to. Also get `OG_MK` if you can; two preflight tests are skipped without it.
3. **Unblock Hedera:** the treasury `0.0.11193715` has 6.14 HBAR and **0 USDC**. Submit `TokenAssociateTransaction` for USDC `0.0.429274` (about 0.66 HBAR), confirm the relationship on the mirror, then re-request from the Circle faucet. The Hedera preflight tier switches to USDC automatically at ≥0.10.
4. **Unblock World:** register the Agent Pass app (`WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_ISSUER`) and the IDKit app (`WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`). Sandbox World App issuance can take about an hour, so start it now.
5. Create the HCS topic once and put `HCS_TOPIC_ID` in `.env`. Person A needs it by T+6.
6. Branch: `git switch -c feat/supply`.

A reference Hedera x402 settlement already exists from preflight: `0.0.9185802@1793113830.692484163`. Keep it for the README.

---

## 3. What you deliver, and when

| Hour | Deliverable | Why it matters |
|---|---|---|
| T+4 | Accounts unblocked, `HCS_TOPIC_ID` published | Three people are waiting |
| T+8 | Seller verification route and `sellers` rows; listing creation for API-key rails | Supply exists |
| T+12 | `scripts/seed.ts` producing two asks and a funded key | Unblocks B, C and A |
| T+16 | Demo agent skeleton that pays over x402 | M3 in progress |
| T+18 | World device flow: start, poll, link, raise cap | M6 |
| T+20 | Agent end to end through the router | M3 |
| T+22 | Amend and cancel listings | Sell side of `/trade` |
| T+24 | OAuth routes, flagged off | M9/M10, only if ahead |
| T+28 | Demo rehearsal, READMEs, runbook, submission text | Ship |

Cut order if behind: OAuth rails first, then amend, then the QR (show the verification link as text), then automate the seed by hand.

---

## 4. Seller onboarding

1. Wallet connect (C's UI), then `POST /api/sellers/rp-signature` returns a World RP signature from `signRequest({ signingKeyHex: WORLD_RP_SIGNING_KEY, action: "seller" })`.
2. The IDKit widget runs with the `proofOfHuman` preset, `signal = address` lowercased, and `environment = WORLD_ENV`.
3. `POST /api/sellers/verify` receives `{ address, signed, idkit }`:
   - verify the wallet signature over the canonical message (§10.6 shape: domain, `issued_at`, intent);
   - assert `idkit.environment === WORLD_ENV`;
   - forward to `https://developer.world.org/api/v4/verify/${WORLD_RP_ID}`;
   - require `success === true`;
   - insert the seller with the nullifier as `numeric(78,0)`.
4. A duplicate nullifier is a 409: one human, one seller. A cancelled or failed proof inserts nothing.

The proof is bound to the wallet through `signal`, so a stolen proof cannot be replayed with another address.

---

## 5. Listing

```ts
export type ListingIntent = {
  action: "list";
  rail: RailId;
  model: string;
  capacity_mtok: string;
  price_micro_per_mtok: string | null;
  client_nonce: string;
};
export type Credential = { kind: "key"; key: string } | { kind: "oauth" };
```

`POST /api/listings` with `{ signed, credential }`:

1. Verify the signature, the seller exists, the rail is enabled.
2. `ref = reference(model)?.pricing`, missing → 404. `price === null || price < blended(ref)`, else 400. A blank price requires `rail.resetPeriod !== null`.
3. Probe the credential, free of charge: `0g` uses `POST /chat/completions` with `{ model: "__probe__" }` and expects 404 `model_not_found`; `anthropic` and `openai` use `GET /models`; `openrouter` uses `GET /api/v1/key`, which also returns `limit_remaining` as a capacity hint; gateways use `GET /models`. 401/403 rejects.
4. Key credential → insert `active`, `auth_kind = 'key'`, `credential_ciphertext = seal(key)`. OAuth → insert `pending_auth`, return `{ authorization_url }`.
5. `capacity_tokens = capacity_mtok * 1e6`. On OAuth rails capacity is advisory.

`PATCH /api/listings/:id` with a signed amend intent re-runs the price rule and updates price and capacity. Capacity may not drop below `used + reserved`. `DELETE` sets `cancelled` only when no reservation is open.

All mutations are wallet-signed with a domain, a 5-minute freshness window and a unique `client_nonce`, which is what makes replays harmless.

---

## 6. World Agent Pass

```ts
export function oidc(): Promise<Configuration>;
export function startApproval(keyId: string, kind: "link_human" | "raise_cap", capMicro: bigint | null): Promise<ApprovalStart>;
export function pollApproval(approvalId: string): Promise<ApprovalStatus>;
```

- `oidc()` uses `discovery(new URL(WORLD_ISSUER), WORLD_CLIENT_ID, WORLD_CLIENT_SECRET)`, cached.
- `startApproval` uses `initiateDeviceAuthorization(config, { scope: "openid" })` and stores the sealed device code, the user code, `verification_uri_complete`, the interval and the expiry.
- `pollApproval` makes **one** attempt per call, never blocks: `genericGrantRequest(config, "urn:ietf:params:oauth:grant-type:device_code", { device_code })`.
  - pending or slow-down → `pending`;
  - `access_denied` → `denied`; `expired_token` or past expiry → `expired`;
  - success → claims are validated by openid-client; require `auth_time >= approval.created_at - 5s`;
  - `link_human` sets `keys.world_sub`;
  - `raise_cap` requires `sub === keys.world_sub`, then sets the cap.
- Raising a cap without a linked human is a 403 that tells the client to link first.

The UI shows the QR; you own the endpoints behind it. The same `verification_uri_complete` is printed by the demo agent, so approval works with no browser at all.

---

## 7. OAuth rails (flagged off)

`ENABLE_OAUTH_RAILS=0` by default. When on:

1. `startUrl` uses PKCE S256 with `node:crypto`, `state = seal({ listing_id, nonce, exp })`. Scopes: `user:inference user:profile` for Claude Code, the Codex client scope for Codex. Client ids are the vendors' published CLI clients.
2. `complete` verifies the state, rejects a reused nonce, exchanges the code for `{ access, refresh, expires_at, account_id }`, seals the set, sets `account_ref`, flips the listing to `active`.
3. `accessToken` returns the cached token while it has more than 60 seconds left, otherwise refreshes and re-seals. An in-process `Map<listingId, Promise<string>>` dedupes concurrent refreshes; a cross-instance race costs one request to failover.
4. `claude-code` speaks `anthropic-messages`; `codex` speaks `openai-responses` and sends `chatgpt-account-id`.
5. A 401/403 marks the listing `invalid` on the first attempt. No retry loop.

**Expect these to be refused.** Anthropic blocks subscription tokens outside its own CLI and OpenAI's Codex endpoint only accepts first-party originators. That is recorded as a known limit, not a surprise. Probe both with throwaway accounts before trusting them.

---

## 8. The seed script

`scripts/seed.ts`, idempotent — running it twice must not create duplicate listings or mint money twice.

It creates:

1. A seller row for the team address (nullifier can be a fixed test value; no World proof needed for the seed).
2. Two `0g` listings on the demo model: one small and 15% under the reference price, one larger and 3% under. The cheap one must be small enough that the demo buy drains it and spills into the second, which is what moves the average.
3. One router key with a USD balance, printed once to the terminal.
4. Vault funding on Galileo and MockUSDC for judges.
5. Optionally an HCS marker message so `/receipts` is not empty before the first fill.

Hand B the key and the listing ids; hand C the model id for the deep link.

---

## 9. The demo agent

`agents/demo/main.ts`, per plan §13:

1. Build a Hedera signer with `createClientHederaSigner`, wrap fetch with `wrapFetchWithPayment` and the `exact` Hedera scheme.
2. `pay(ROUTER_URL + "/api/v1/topup?usd=0.50")` → router key.
3. `PATCH /keys/settings` → auto top-up and a daily cap.
4. `new OpenAI({ baseURL: ROUTER_URL + "/api/v1", apiKey, fetch: pay })`, then stream a few requests.
5. On 403 `approval_required`, print `verification_uri_complete`, poll `/approvals/:id`, retry; print the deny path when denied.
6. Hedge on Galileo: MockUSDC `mint`, `approve`, `PerpMarket.modify`.
7. Print a HashScan link for every top-up.

The agent account must exist on the mirror node for about a minute before it pays, or facilitators reject the first attempt.

---

## 10. Gotchas

- The 0G key must belong to the same account as the funded wallet, or every request 402s.
- The Hedera treasury needs the USDC association before the faucet will fund it.
- World sandbox app issuance can take an hour. Start early; a mocked proof is acceptable only if the event allows it.
- Facilitation and mirror reads lag by a few seconds. Do not assert on a payment in the same tick.
- The preflight suite at `~/ethglobal-preflight` stays outside the repo — ETHGlobal forbids project code before kickoff. Poll it for regressions; do not copy it in.
- The `__probe__` trick (valid key + unknown model → 404, not 401) is documented but untested. Verify it on day one.

---

## 11. Definition of done

- From a clean database, `scripts/seed.ts` produces the demo state, and the demo agent completes: top up, stream, hit the cap, approve, continue.
- A seller can verify with World ID, connect a key, list, and appear on `/trade` in under a minute.
- A duplicate human is rejected with 409.
- The denied approval path is captured on video.

## 12. Do not touch

`apps/web/lib/{schema,price,x402}.ts` (ask B), `apps/web/app/**` pages (C), `contracts/**`, `keeper/**`.

## 13. Your part in the demo

You run the agent terminal at 0:45, 1:15 and 2:10. You also own the READMEs and the submission text, because you are the one who knows which sponsor wants which link.
