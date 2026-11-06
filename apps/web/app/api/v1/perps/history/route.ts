import { z } from "zod";
import { fail } from "../../../../../lib/errors.ts";
import { perpHistory } from "../../../../../lib/perp-events.ts";

const accountSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export async function GET(request: Request): Promise<Response> {
  const account = accountSchema.safeParse(new URL(request.url).searchParams.get("account"));
  if (!account.success) return fail(400, "invalid_request", "expected ?account=0x… (a 20-byte address)");
  return Response.json({ data: await perpHistory(account.data) });
}
