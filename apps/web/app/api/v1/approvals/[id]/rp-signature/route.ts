import { z } from "zod";
import { approvalAction, pendingApproval } from "../../../../../../lib/approvals.ts";
import { fail } from "../../../../../../lib/errors.ts";
import { rpSignature, worldEnvironment } from "../../../../../../lib/world.ts";

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail(404, "invalid_request", "approval not found");

  const approval = await pendingApproval(id);
  if (!approval) return fail(404, "invalid_request", "approval not found or expired");

  const rpId = process.env.WORLD_RP_ID;
  if (!rpId) return fail(400, "invalid_request", "world is not configured");

  try {
    return Response.json({
      ...rpSignature(approvalAction()),
      rp_id: rpId,
      app_id: process.env.WORLD_APP_ID ?? null,
      environment: worldEnvironment(),
      action: approvalAction(),
    });
  } catch {
    return fail(400, "invalid_request", "world rp signing is not configured");
  }
}
