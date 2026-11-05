import { fail } from "../../../../lib/errors.ts";
import { rpSignature, worldEnvironment } from "../../../../lib/world.ts";

export async function POST(): Promise<Response> {
  const rpId = process.env.WORLD_RP_ID;
  if (!rpId) return fail(400, "invalid_request", "world is not configured");
  try {
    return Response.json({
      ...rpSignature("seller"),
      rp_id: rpId,
      app_id: process.env.WORLD_APP_ID ?? null,
      environment: worldEnvironment(),
      action: "seller",
    });
  } catch {
    return fail(400, "invalid_request", "world rp signing is not configured");
  }
}
