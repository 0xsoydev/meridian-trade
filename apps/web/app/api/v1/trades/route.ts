import { z } from "zod";
import { routerKey } from "../../../../lib/auth.ts";
import { restBid } from "../../../../lib/bids.ts";
import { asks, type Ask } from "../../../../lib/book.ts";
import { fail } from "../../../../lib/errors.ts";
import { fill, nextUtcMidnight, prepaidHolding } from "../../../../lib/ledger.ts";
import { buyOffer, offerAsks, type OfferAsk } from "../../../../lib/offers.ts";
import { charge, formatMicroPerMtok, listCeiling, sellerEarning } from "../../../../lib/price.ts";
import { catalog, reference } from "../../../../lib/rails.ts";
import { applyPayment, paymentDue } from "../../../../lib/x402.ts";
import type { Trade, TradeResult } from "../../../../lib/types";

const MAX_TRADE_TOKENS = 1_000_000_000n;

const intentSchema = z.object({
  model: z.string().min(1),
  tokens: z.string().regex(/^\d{1,13}$/),
  limit_price_micro_per_mtok: z.string().regex(/^[1-9]\d{0,12}$/).optional(),
});

type Source = { price: bigint; tokensLeft: bigint; createdAt: Date } & (
  | { kind: "listing"; ask: Ask }
  | { kind: "resale"; offer: OfferAsk }
);
type Step = { source: Source; take: bigint; cost: bigint };

export async function POST(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = intentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "expected { model, tokens } with tokens as an integer string");
  const { model } = parsed.data;
  const tokens = BigInt(parsed.data.tokens);
  const limit = parsed.data.limit_price_micro_per_mtok === undefined ? null : BigInt(parsed.data.limit_price_micro_per_mtok);
  if (tokens <= 0n || tokens > MAX_TRADE_TOKENS) {
    return fail(400, "invalid_request", `tokens must be between 1 and ${MAX_TRADE_TOKENS}`);
  }
  if (!(await reference(model))) return fail(404, "model_not_found", `unknown model: ${model}`);
  const ceiling = listCeiling(model, await catalog());
  if (limit !== null && ceiling !== null && limit > ceiling) {
    return fail(400, "invalid_request", `the limit is above the ${formatMicroPerMtok(ceiling)} USD/MTok list price, and no ask can sit above it`);
  }

  const payment = await applyPayment(request, key);
  if ("error" in payment) return payment.error;
  const headers: Record<string, string> = payment.header ? { "PAYMENT-RESPONSE": payment.header } : {};

  const [listed, resold] = await Promise.all([asks(model), offerAsks(model, key.id)]);
  const sources: Source[] = [
    ...listed.map((ask) => ({ kind: "listing" as const, ask, price: ask.price, tokensLeft: ask.tokensLeft, createdAt: ask.createdAt })),
    ...resold.map((offer) => ({ kind: "resale" as const, offer, price: offer.price, tokensLeft: offer.tokensLeft, createdAt: offer.createdAt })),
  ].sort((a, b) => (a.price === b.price ? a.createdAt.getTime() - b.createdAt.getTime() : a.price < b.price ? -1 : 1));

  const steps: Step[] = [];
  let left = tokens;
  let quote = 0n;
  for (const source of sources) {
    if (left === 0n || (limit !== null && source.price > limit)) break;
    const take = source.tokensLeft < left ? source.tokensLeft : left;
    const cost = charge(take, source.price);
    steps.push({ source, take, cost });
    quote += cost;
    left -= take;
  }
  if (steps.length === 0 && limit === null) return fail(404, "no_liquidity", `no asks for ${model}`);

  const due = await paymentDue(request, key.id, quote + (limit === null ? 0n : charge(left, limit)));
  if (due) return due;

  const takeBps = BigInt(process.env.TAKE_BPS ?? "1000");
  const now = new Date();
  const fills: Trade[] = [];
  let filled = 0n;
  for (const { source, take, cost } of steps) {
    const result =
      source.kind === "listing"
        ? await fill({
            keyId: key.id,
            listingId: source.ask.listingId,
            model,
            tokens: take,
            price: source.price,
            chargeMicro: cost,
            sellerEarningMicro: sellerEarning(cost, takeBps),
            expiresAt: source.ask.rail.resetPeriod === "daily" ? nextUtcMidnight(now) : null,
          })
        : await buyOffer({ offerId: source.offer.offerId, buyerKeyId: key.id, take, takeBps }).then((bought) => ({
            listingOk: bought.offerOk,
            keyOk: bought.keyOk,
          }));
    if (result.listingOk && !result.keyOk) break;
    if (!result.listingOk) continue;
    filled += take;
    fills.push({
      listing_id: source.kind === "listing" ? source.ask.listingId : source.offer.listingId,
      tokens: take.toString(),
      price_micro_per_mtok: source.price.toString(),
      charge_usd_micro: cost.toString(),
    });
  }
  const bid = limit !== null && filled < tokens ? await restBid(key.id, model, limit, tokens - filled) : null;
  if (fills.length === 0 && bid === null) {
    return limit === null
      ? fail(409, "no_liquidity", "the asks moved before they could be filled; retry")
      : fail(402, "insufficient_balance", "the balance cannot hold this bid");
  }

  const result: TradeResult = { fills, bid, prepaid_tokens: (await prepaidHolding(key.id, model)).toString() };
  return Response.json(result, { headers });
}
