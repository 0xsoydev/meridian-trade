import { fail } from "../../../../lib/errors.ts";
import { rpSignature } from "../../../../lib/world.ts";

export async function POST(): Promise<Response> {
  try {
    return Response.json(rpSignature("seller"));
  } catch {
    return fail(400, "invalid_request", "world rp signing is not configured");
  }
}
