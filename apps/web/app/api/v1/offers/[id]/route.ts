import { z } from "zod";
import { routerKey } from "../../../../../lib/auth.ts";
import { fail } from "../../../../../lib/errors.ts";
import { cancelOffer } from "../../../../../lib/offers.ts";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success || !(await cancelOffer(id, key.id))) {
    return fail(404, "invalid_request", "no open offer with that id");
  }
  return Response.json({ offer_id: id, status: "cancelled" });
}
