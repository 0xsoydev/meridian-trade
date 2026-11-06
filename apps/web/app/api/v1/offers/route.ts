import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { openOffers } from "../../../../lib/offers.ts";

export async function GET(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");
  return Response.json({ data: await openOffers(key.id, new URL(request.url).searchParams.get("model")) });
}
