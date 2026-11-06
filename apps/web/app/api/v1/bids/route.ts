import { and, desc, eq } from "drizzle-orm";
import { routerKey } from "../../../../lib/auth.ts";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { bids } from "../../../../lib/schema.ts";
import type { Bid } from "../../../../lib/types";

export async function GET(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const model = new URL(request.url).searchParams.get("model");
  const rows = await db()
    .select()
    .from(bids)
    .where(and(eq(bids.keyId, key.id), eq(bids.status, "open"), model ? eq(bids.model, model) : undefined))
    .orderBy(desc(bids.createdAt))
    .limit(100);

  const data: Bid[] = rows.map((row) => ({
    bid_id: row.id,
    model: row.model,
    tokens: row.tokens.toString(),
    price_micro_per_mtok: row.priceMicroPerMtok.toString(),
    hold_usd_micro: row.holdUsdMicro.toString(),
    created_at: row.createdAt.toISOString(),
  }));
  return Response.json({ data });
}
