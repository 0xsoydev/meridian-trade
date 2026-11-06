import { z } from "zod";
import { startApproval } from "../../../../lib/approvals.ts";
import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";

const bodySchema = z.object({ kind: z.literal("link_human") }).strict();

export async function POST(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", 'kind must be "link_human"');

  return Response.json(await startApproval(key.id, "link_human", null));
}
