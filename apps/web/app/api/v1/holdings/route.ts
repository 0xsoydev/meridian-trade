import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { holdings } from "../../../../lib/offers.ts";
import type { Holding } from "../../../../lib/types";

export async function GET(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const rows = await holdings(key.id, new URL(request.url).searchParams.get("model"));
  const data: Holding[] = rows.map((row) => ({
    prepaid_id: row.prepaidId,
    model: row.model,
    listing_id: row.listingId,
    rail: row.rail,
    tokens: row.tokens.toString(),
    expires_at: row.expiresAt?.toISOString() ?? null,
  }));
  return Response.json({ data });
}
