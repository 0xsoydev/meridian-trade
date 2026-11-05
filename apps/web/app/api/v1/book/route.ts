import { desc, eq } from "drizzle-orm";
import { asks } from "../../../../lib/book.ts";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { reference } from "../../../../lib/rails.ts";
import { trades } from "../../../../lib/schema.ts";
import type { Book } from "../../../../lib/types";

export async function GET(request: Request): Promise<Response> {
  const model = new URL(request.url).searchParams.get("model");
  if (!model) return fail(400, "invalid_request", "model is required");
  if (!(await reference(model))) return fail(404, "model_not_found", `unknown model: ${model}`);

  const [open, recent] = await Promise.all([
    asks(model),
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
  ]);

  const book: Book = {
    model,
    asks: open.map((ask) => ({
      listing_id: ask.listingId,
      rail: ask.rail.id,
      price_micro_per_mtok: ask.price.toString(),
      tokens_left: ask.tokensLeft.toString(),
      verifiable: ask.verifiability !== null,
    })),
    fills: recent.map((row) => ({
      listing_id: row.listingId,
      tokens: row.tokens.toString(),
      price_micro_per_mtok: row.price.toString(),
      created_at: row.createdAt.toISOString(),
    })),
  };
  return Response.json(book);
}
