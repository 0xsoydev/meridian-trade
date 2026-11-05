import { z } from "zod";
import { pollApproval } from "../../../../../lib/approvals.ts";
import { routerKey } from "../../../../../lib/auth.ts";
import { fail } from "../../../../../lib/errors.ts";

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail(404, "invalid_request", "approval not found");

  const status = await pollApproval(key.id, id);
  if (!status) return fail(404, "invalid_request", "approval not found");
  return Response.json(status);
}
