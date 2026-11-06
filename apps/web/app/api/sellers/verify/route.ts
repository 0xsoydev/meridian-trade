import { z } from "zod";
import { expectedHost, verifySigned } from "../../../../lib/auth.ts";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { sellers } from "../../../../lib/schema.ts";
import { verifyWorld } from "../../../../lib/world.ts";

const bodySchema = z
  .object({
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    signed: z.unknown(),
    idkit: z.unknown(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid seller verification");

  const verified = await verifySigned(parsed.data.signed, expectedHost(request), "seller");
  if (!verified) return fail(401, "invalid_api_key", "invalid wallet signature");

  const address = verified.address;
  if (address !== parsed.data.address.toLowerCase()) {
    return fail(401, "invalid_api_key", "signature does not match the address");
  }

  const checked = await verifyWorld(parsed.data.idkit, { action: "seller", signal: address });
  if ("error" in checked) return fail(400, "invalid_request", checked.error);

  const [created] = await db()
    .insert(sellers)
    .values({ address, worldNullifier: checked.worldNullifier })
    .onConflictDoNothing()
    .returning({ id: sellers.id });

  if (!created) return fail(409, "invalid_request", "this human already has a seller");
  return Response.json({ seller_id: created.id, address });
}
