import { z } from "zod";
import { denyApproval } from "../../../../../../lib/approvals.ts";
import { fail } from "../../../../../../lib/errors.ts";

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail(404, "invalid_request", "approval not found");

  const denied = await denyApproval(id);
  if (!denied) return fail(409, "invalid_request", "approval is not pending");
  return Response.json({ status: "denied" });
}
