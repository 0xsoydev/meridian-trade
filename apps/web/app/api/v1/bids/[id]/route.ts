import { z } from "zod";
import { routerKey } from "../../../../../lib/auth.ts";
import { cancelBid } from "../../../../../lib/bids.ts";
import { fail } from "../../../../../lib/errors.ts";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return fail(404, "invalid_request", "no open bid with that id");

  const balance = await cancelBid(id, key.id);
  if (balance === null) return fail(404, "invalid_request", "no open bid with that id");
  return Response.json({ bid_id: id, status: "cancelled", balance_usd_micro: balance.toString() });
}
