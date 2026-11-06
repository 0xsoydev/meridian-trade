import { and, desc, eq, sum } from "drizzle-orm";
import { asks } from "../../../../lib/book.ts";
import { offerAsks } from "../../../../lib/offers.ts";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { reference } from "../../../../lib/rails.ts";
import { bids, trades } from "../../../../lib/schema.ts";
import type { Book } from "../../../../lib/types";

export async function GET(request: Request): Promise<Response> {
  const model = new URL(request.url).searchParams.get("model");
  if (!model) return fail(400, "invalid_request", "model is required");
  if (!(await reference(model))) return fail(404, "model_not_found", `unknown model: ${model}`);

  const [open, resold, recent, levels] = await Promise.all([
    asks(model),
    offerAsks(model, null),
    db()
      .select({
        listingId: trades.listingId,
        tokens: trades.tokens,
        price: trades.priceMicroPerMtok,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .where(eq(trades.model, model))
      .orderBy(desc(trades.createdAt))
      .limit(50),
    db()
      .select({ price: bids.priceMicroPerMtok, tokens: sum(bids.tokens) })
      .from(bids)
      .where(and(eq(bids.model, model), eq(bids.status, "open")))
      .groupBy(bids.priceMicroPerMtok)
      .orderBy(desc(bids.priceMicroPerMtok))
      .limit(20),
  ]);

  const book: Book = {
    model,
    asks: [
      ...open.map((ask) => ({
        listing_id: ask.listingId,
        offer_id: null,
        kind: "listing" as const,
        rail: ask.rail.id,
        price: ask.price,
        tokens_left: ask.tokensLeft.toString(),
        verifiable: ask.verifiability !== null,
        createdAt: ask.createdAt,
      })),
      ...resold.map((offer) => ({
        listing_id: offer.listingId,
        offer_id: offer.offerId,
        kind: "resale" as const,
        rail: offer.rail.id,
        price: offer.price,
        tokens_left: offer.tokensLeft.toString(),
        verifiable: offer.verifiability !== null,
        createdAt: offer.createdAt,
      })),
    ]
      .sort((a, b) => (a.price === b.price ? a.createdAt.getTime() - b.createdAt.getTime() : a.price < b.price ? -1 : 1))
      .map((ask) => ({
        listing_id: ask.listing_id,
        offer_id: ask.offer_id,
        kind: ask.kind,
        rail: ask.rail,
        price_micro_per_mtok: ask.price.toString(),
        tokens_left: ask.tokens_left,
        verifiable: ask.verifiable,
      })),
    bids: levels.map((level) => ({ price_micro_per_mtok: level.price.toString(), tokens: level.tokens ?? "0" })),
    fills: recent.map((row) => ({
      listing_id: row.listingId,
      tokens: row.tokens.toString(),
      price_micro_per_mtok: row.price.toString(),
      created_at: row.createdAt.toISOString(),
    })),
  };
  return Response.json(book);
}
