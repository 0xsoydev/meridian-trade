import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { keyFills } from "../../../../lib/offers.ts";

export async function GET(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");
  return Response.json({ data: await keyFills(key.id) });
}
