# Handoff — Person C: Frontend

**Event:** ETHGlobal Mumbai, 5–7 Nov 2026. **Deadline:** Sat 7 Nov, 09:00 IST.
**Your name:** ______________
**Read first:** the plan at `llm-token-exchange.md`, §14 (frontend), §10.10 (spot fills), §11 (the perp formulas you display).
**You own:** `apps/web/app/**` pages, `apps/web/components/**`, `apps/web/app/providers.tsx`, all chart code.

---

## 1. Your mission

Six pages, and they are the demo. Two of them carry the pitch: `/trade` shows a market clearing, `/perps` shows a price moving. The landing page is already designed, so your first real job is turning Figma into working Next.js, not inventing visuals.

You consume APIs. You do not write them, and you do not touch contracts.

---

## 2. First 30 minutes

1. Get Figma **dev mode** access and confirm you can inspect spacing, colours and fonts. Export any images at 2x.
2. Write down the design tokens once, in `app/globals.css` as CSS variables: colour scale, radius, spacing, font families. Tailwind 4 reads them directly.
3. Create the route shells: `/`, `/trade`, `/perps`, `/sell`, `/keys`, `/receipts`. Each returns a heading. Commit. Now the team has links.
4. Set up `providers.tsx`: `PrivyProvider` (Galileo as default chain) → `QueryClientProvider` → `WagmiProvider` from `@privy-io/wagmi`.
5. Branch: `git switch -c feat/web`.

If the Figma landing page conflicts with the plan's `/` content, the Figma wins. Put a compact live strip (best ask and index for three models) wherever the design has room, and link into `/trade?model=`.

---

## 3. What you deliver, and when

| Hour | Deliverable | Why it matters |
|---|---|---|
| T+2 | Tokens, shells, providers, layout, nav | Everyone can navigate |
| T+8 | `/` from Figma; `/trade` layout with a hardcoded book | The demo has a front door |
| T+14 | `/trade` wired to `/book` and `/trades`; buy form with fee breakdown | First real interaction |
| T+20 | `/perps`: chart, ticket, positions, faucet | The second act |
| T+24 | `/sell`, `/keys`, `/receipts` | Sponsor evidence |
| T+26 | Empty, error and loading states; polish | Freeze |

Cut order if behind: `/receipts` recompute button, then the `/keys` QR (show the link as text), then the positions tab, then inline amend on `/trade` (link to `/sell` instead).

---

## 4. Pages

### `/` — landing, from Figma

Whatever the design says. At minimum: a clear promise, a live strip (best ask and index per model), and one primary button into `/trade?model=<the demo model>`. No wallet needed to view.

### `/trade` — the spot venue

One page, both sides.

- Model picker at the top, bound to `?model=`. Default to the demo model. Changing it is a client-side route update, not a reload.
- **Ask book**: price per MTok, MTokens left, rail badge, verifiable badge. Sorted ascending.
- **Buy**: size input in MTokens (show the USD equivalent live), then a breakdown — price, 10% platform fee, total. Submit calls `POST /api/v1/trades`. On success, list the fills and link each to `/receipts`.
- **Sell tab**: your own asks with amend price, add capacity, cancel. If there is no source for this model yet, show one button to `/sell`.
- **Recent fills** underneath, from `GET /api/v1/book`.
- The router key comes from `localStorage`. If absent, show a short "connect your agent" panel linking to `/keys`.

### `/perps` — the perp venue

- Model picker, bound to `?model=`.
- Chart: two series, the on-chain index and the per-minute VWAP.
- Header strip: mark price, funding rate per hour, open interest, last update age.
- Ticket: long/short, size in MTokens, leverage 1–5, margin, and a **previewed liquidation price** computed with the contract's formulas before submitting.
- Positions tab: every market this wallet has a position in, with size, entry, equity and liquidation price.
- MockUSDC balance and a faucet button. If the wallet is not connected or is on the wrong chain, hide the ticket and show connect.
- Before the first index post exists, show "waiting for the first index post", not an empty chart.

### `/sell` — setup and accounting

Wallet connect → World ID verification → source picker (0G key, Anthropic, OpenAI, OpenRouter, Command Code, OpenCode Zen, or the OAuth buttons when enabled) → new listing form (model, MTokens, price or blank) → your listings, earnings, payouts with HashScan links.

This page also handles the OAuth callback redirect. If `ENABLE_OAUTH_RAILS` is off, hide those two buttons.

### `/keys` — the human behind an agent

Paste a router key (store in `localStorage`). Then: balance, reserved, topped up today against the daily cap, auto top-up amount, default model, and a "link a human" button that starts a World approval and renders the returned `verification_uri_complete` as a QR plus a short code, polling `/api/v1/approvals/:id` until it resolves.

Make it obvious this is not a login. The key is the credential; this page only configures it.

### `/receipts` — the proof page

Three lists: HCS minute rollups, x402 top-ups with HashScan links, index posts with their sequence ranges. Plus the recompute button: fetch the rollups from the mirror node in the browser, recompute the TWAP with the same clamp, compare it with `IndexOracle.latest`, and show a green tick or the difference.

---

## 5. Charts — Lightweight Charts v5

The v4 API names do not exist in v5, and most examples online are v4. Pin these:

```ts
import { createChart, LineSeries, createSeriesMarkers, type UTCTimestamp } from "lightweight-charts";

const chart = createChart(el, { autoSize: true, layout: { background: { color: "transparent" }, textColor: "#888" }, grid: { vertLines: { visible: false }, horzLines: { color: "#1a1a1a" } } });
const index = chart.addSeries(LineSeries, { color: "#6ee7b7", lineWidth: 2 });
const vwap = chart.addSeries(LineSeries, { color: "#71717a", lineWidth: 1, priceScaleId: "left" });
chart.applyOptions({ leftPriceScale: { visible: true } });
```

- Times are `UTCTimestamp` **in seconds**: `Math.floor(ms / 1000)`.
- Data must be strictly ascending with unique times.
- `setData` once for history, then `series.update(point)` for each new point. Never `setData` on a tick — it resets the visible range.
- Markers are a primitive in v5: `const markers = createSeriesMarkers(series, [])`, then `markers.setMarkers([...])`. `series.setMarkers` does not exist.
- Teardown is `chart.remove()` in the effect cleanup.
- Next.js: `"use client"`, create in `useEffect`, never on every render.
- No timezone option exists. Format labels with `tickMarkFormatter` and `Intl.DateTimeFormat`.
- Poll `/api/v1/book` (fills) and the mirror node every 15 seconds. Cheap, and it keeps the demo live.

---

## 6. Data you consume

| Source | Shape you need |
|---|---|
| `GET /api/v1/models` | `{ id, rails, verifiability, reference_blended_micro_per_mtok, best_ask_micro_per_mtok, index_micro_per_mtok, available_tokens }` |
| `GET /api/v1/book?model=` | `{ asks: [{ listing_id, rail, price_micro_per_mtok, tokens_left, verifiable }], fills: [{ tokens, price_micro_per_mtok, created_at }] }` |
| `POST /api/v1/trades` | `{ fills: [{ listing_id, tokens, price_micro_per_mtok, charge_usd_micro }], prepaid_tokens }` |
| `GET /api/v1/balance` | balance, reserved, topped up today, cap, auto top-up, default model, `human_linked` |
| `PATCH /api/v1/keys/settings` | same shape back |
| `lib/perp.ts` (Person A) | market read, position read, liquidation price, `modify`, `liquidate` |

Until B ships an endpoint, use a local fixture file with the same shape. Do not invent a different shape; that is how integration eats a day.

All amounts arrive as decimal strings. Format with one money formatter, and never do arithmetic in floating point.

---

## 7. Gotchas

- There is no browser payment path for Hedera. `/trade` cannot charge anything. If the balance is short, show the exact amount needed and copy the agent top-up command to the clipboard.
- A buy with an empty book is not an error: show "no asks yet" and link into Sell.
- `/perps` must refuse to render the ticket until the wallet is on Galileo and has been approved for MockUSDC.
- Fee transparency matters: show the 10% take rate before submit, not after.
- The landing page design is the source of truth for branding; the plan is the source of truth for behaviour. When they disagree, ask.
- Do not put a router key in a URL. It is a credential. Paste it, store it locally, never in a query string.

---

## 8. Definition of done

- A judge can go from `/` to `/trade`, pick a model, buy, see the fills, and open `/receipts` without a terminal.
- `/perps` shows the index updating while the keeper posts, and a position's equity changing with the price.
- Every empty and error state renders something readable, not a blank box.
- No page crashes without a wallet connected.

## 9. Do not touch

`apps/web/app/api/**`, `apps/web/lib/**` (ask B or A), `contracts/**`, `keeper/**`, `agents/**`, `scripts/**`.

## 10. Your part in the demo

You drive the browser at 0:20 (`/sell`), 1:15 (`/trade`) and 2:35 (`/receipts`). Rehearse those three clicks until they are boring. The chart at 1:15 has about 90 seconds to show the move, so make sure the poll interval is 15 seconds, not 60.
