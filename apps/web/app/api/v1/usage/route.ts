import { desc, eq } from "drizzle-orm";
import { routerKey } from "../../../../lib/auth.ts";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { listings, usage } from "../../../../lib/schema.ts";
import type { KeyUsage } from "../../../../lib/types";

export async function GET(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const rows = await db()
    .select({
      at: usage.createdAt,
      model: listings.model,
      rail: usage.rail,
      status: usage.status,
      prompt: usage.promptTokens,
      completion: usage.completionTokens,
      mixed: usage.mixedTokens,
      charge: usage.chargeUsdMicro,
      prepaidId: usage.prepaidId,
      requestId: usage.upstreamRequestId,
    })
    .from(usage)
    .innerJoin(listings, eq(listings.id, usage.listingId))
    .where(eq(usage.keyId, key.id))
    .orderBy(desc(usage.createdAt))
    .limit(100);

  const data: KeyUsage[] = rows.map((row) => ({
    at: row.at.toISOString(),
    model: row.model,
    rail: row.rail,
    status: row.status,
    prompt_tokens: row.prompt,
    completion_tokens: row.completion,
    mixed_tokens: row.mixed.toString(),
    charge_usd_micro: row.charge.toString(),
    paid_from: row.prepaidId ? "prepaid" : "balance",
    upstream_request_id: row.requestId,
  }));
  return Response.json({ data });
}
