import { z } from "zod";
import { routerKey } from "../../../../../lib/auth.ts";
import { agentName, connectComfy, listComfy } from "../../../../../lib/comfy.ts";
import { fail } from "../../../../../lib/errors.ts";

const bodySchema = z.object({ agent: agentName }).strict();

export async function PUT(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "agent must be 1-64 letters, digits, spaces, _ . or -");

  const outcome = await connectComfy(key, parsed.data.agent);
  if (outcome === "unverified") {
    return fail(
      403,
      "approval_required",
      'link a verified human first: POST /api/v1/approvals with {"kind":"link_human"}',
    );
  }
  return Response.json({ agent: parsed.data.agent, verified_human: true });
}

export async function GET(): Promise<Response> {
  const rows = await listComfy();
  return Response.json({
    data: rows.map((row) => ({
      agent: row.agent,
      since: row.since.toISOString(),
      requests: row.requests,
      spent_usd_micro: row.spentUsdMicro.toString(),
    })),
  });
}
