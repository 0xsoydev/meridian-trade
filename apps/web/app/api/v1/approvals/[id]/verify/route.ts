import { z } from "zod";
import { approveWithProof } from "../../../../../../lib/approvals.ts";
import { fail } from "../../../../../../lib/errors.ts";

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const bodySchema = z.object({ idkit: z.unknown() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail(404, "invalid_request", "approval not found");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid approval proof");

  const outcome = await approveWithProof(id, parsed.data.idkit);
  if (!outcome.approved) {
    return fail(
      outcome.httpStatus,
      outcome.httpStatus === 403 ? "approval_required" : "invalid_request",
      outcome.error,
    );
  }
  return Response.json({ status: "approved" });
}
