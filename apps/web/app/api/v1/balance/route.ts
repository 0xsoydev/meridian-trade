import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { balanceOf } from "../../../../lib/ledger.ts";

export async function GET(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");
  const balance = await balanceOf(key.id);
  return balance ? Response.json(balance) : fail(401, "invalid_api_key", "invalid router key");
}
