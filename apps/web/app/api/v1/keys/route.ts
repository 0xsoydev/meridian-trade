import { createKey, ensureAccount, listKeys } from "../../../../lib/accounts.ts";
import { expectedHost, verifySigned } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { verifyWorld } from "../../../../lib/world.ts";
import type { CreateKeyResult } from "../../../../lib/types";

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const host = expectedHost(request);
  const signed = await verifySigned(body, host, "create_key");
  if (!signed) return fail(401, "invalid_api_key", "a fresh wallet signature is required");

  const world = (body as { world?: unknown } | null)?.world;
  let worldNullifier: string | null = null;
  if (world !== undefined && world !== null) {
    const checked = await verifyWorld(world);
    if ("error" in checked) return fail(400, "invalid_request", checked.error);
    worldNullifier = checked.worldNullifier;
  }

  const account = await ensureAccount(signed.address, worldNullifier);
  if ("conflict" in account) return fail(409, "invalid_request", "this human already has an account");

  const key = await createKey(account.id);
  const result: CreateKeyResult = { key: key.raw, key_id: key.id };
  return Response.json(result);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const signed = await verifySigned(
    {
      address: url.searchParams.get("address"),
      message: url.searchParams.get("message"),
      signature: url.searchParams.get("signature"),
    },
    expectedHost(request),
    "list_keys",
  );
  if (!signed) return fail(401, "invalid_api_key", "a fresh wallet signature is required");

  const account = await ensureAccount(signed.address, null);
  if ("conflict" in account) return fail(409, "invalid_request", "account unavailable");
  return Response.json({ keys: await listKeys(account.id) });
}
