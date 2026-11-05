import { eq } from "drizzle-orm";
import { z } from "zod";
import { expectedHost, verifySigned } from "../../../lib/auth.ts";
import { db } from "../../../lib/db.ts";
import { fail } from "../../../lib/errors.ts";
import { listingPriceError, parseCapacityMtok } from "../../../lib/listings.ts";
import { catalog } from "../../../lib/rails.ts";
import { listings, sellers } from "../../../lib/schema.ts";
import { seal } from "../../../lib/secrets.ts";
import type { Rail } from "../../../lib/types";

const railIds = [
  "0g",
  "stub",
  "anthropic",
  "openai",
  "openrouter",
  "commandcode",
  "zen",
  "opencode-go",
  "claude-code",
  "codex",
] as const;

const intentSchema = z
  .object({
    domain: z.string(),
    action: z.literal("list"),
    issued_at: z.string(),
    rail: z.enum(railIds),
    model: z.string().min(1).max(200),
    capacity_mtok: z.string().regex(/^\d{1,18}$/),
    price_micro_per_mtok: z.string().regex(/^\d{1,18}$/).nullable(),
    client_nonce: z.string().min(8).max(128),
  })
  .strict();

const bodySchema = z
  .object({
    signed: z.unknown(),
    credential: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("key"), key: z.string().min(1).max(4096) }).strict(),
      z.object({ kind: z.literal("oauth") }).strict(),
    ]),
  })
  .strict();

const listedSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

type Probe = { ok: true } | { ok: false; status: number; message: string };

function authStatus(status: number): number {
  return status === 401 || status === 403 ? status : 502;
}

async function probeKey(rail: Rail, upstream: string, key: string): Promise<Probe> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    ...(rail.id === "anthropic" ? { "x-api-key": key } : {}),
    ...rail.extraHeaders,
  };
  try {
    if (rail.check === "probe") {
      const response = await fetch(`${rail.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ model: "__probe__", messages: [{ role: "user", content: "." }], max_tokens: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return { ok: true };
      return { ok: false, status: authStatus(response.status), message: `${rail.id} probe did not answer model_not_found` };
    }

    if (rail.check === "key") {
      const response = await fetch(`${rail.baseUrl}/key`, { headers, signal: AbortSignal.timeout(15_000) });
      if (response.ok) return { ok: true };
      return { ok: false, status: authStatus(response.status), message: `credential probe answered ${response.status}` };
    }

    if (rail.check === "models") {
      const response = await fetch(rail.modelsUrl, { headers, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { ok: false, status: response.status, message: `the model list answered ${response.status}` };
      const listed = listedSchema.safeParse(await response.json().catch(() => null));
      if (!listed.success) return { ok: false, status: 502, message: `${rail.id} sent an unreadable model list` };
      if (listed.data.data.some((entry) => entry.id === upstream)) return { ok: true };
      return { ok: false, status: 404, message: `${upstream} is not in this key's model list` };
    }

    const response = await fetch(`${rail.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: upstream,
        messages: [{ role: "user", content: "." }],
        [rail.maxTokensField ?? "max_tokens"]: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return { ok: true };
    return { ok: false, status: response.status, message: `${rail.id} answered ${response.status}` };
  } catch {
    return { ok: false, status: 0, message: "credential probe failed" };
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid listing request");

  const verified = await verifySigned(parsed.data.signed, expectedHost(request), "list");
  if (!verified) return fail(401, "invalid_api_key", "invalid wallet signature");

  const intent = intentSchema.safeParse(verified.intent);
  if (!intent.success) return fail(400, "invalid_request", "invalid listing intent");

  const [seller] = await db()
    .select({ id: sellers.id })
    .from(sellers)
    .where(eq(sellers.address, verified.address))
    .limit(1);
  if (!seller) return fail(403, "invalid_request", "verify the seller wallet first");

  const rails = await catalog();
  const rail = rails.find((entry) => entry.id === intent.data.rail);
  if (!rail) return fail(400, "invalid_request", "rail is not enabled");

  const model = rail.models.find((entry) => entry.canonical === intent.data.model);
  if (!model) return fail(404, "model_not_found", "unknown model for this rail");

  const price =
    intent.data.price_micro_per_mtok === null ? null : BigInt(intent.data.price_micro_per_mtok);
  const priceError = listingPriceError(
    price,
    { prompt: model.listPrompt, completion: model.listCompletion },
    rail.resetPeriod,
  );
  if (priceError) return fail(400, "invalid_request", priceError);

  const capacityTokens = parseCapacityMtok(intent.data.capacity_mtok);
  if (capacityTokens === null) return fail(400, "invalid_request", "invalid capacity");

  const credential = parsed.data.credential;
  if (credential.kind !== "key") {
    return fail(400, "invalid_request", "oauth rails are disabled");
  }
  if (rail.auth !== "key") return fail(400, "invalid_request", "rail does not accept api keys");

  const probe = await probeKey(rail, model.upstream, credential.key);
  if (!probe.ok) {
    if (probe.status === 401 || probe.status === 403) return fail(401, "invalid_api_key", "credential rejected by the rail");
    if (probe.status === 400 || probe.status === 404) {
      return fail(404, "model_not_found", `this key cannot serve ${model.canonical} on ${rail.id}`);
    }
    if (probe.status === 402) return fail(402, "insufficient_balance", `this key has no credit on ${rail.id}`);
    return fail(502, "upstream_failed", probe.message);
  }

  const [created] = await db()
    .insert(listings)
    .values({
      sellerId: seller.id,
      rail: rail.id,
      model: model.canonical,
      authKind: "key",
      credentialCiphertext: seal(credential.key),
      priceMicroPerMtok: price,
      capacityTokens,
      status: "active",
      clientNonce: intent.data.client_nonce,
    })
    .onConflictDoNothing({ target: listings.clientNonce })
    .returning({ id: listings.id });

  if (!created) return fail(409, "invalid_request", "client_nonce has already been used");

  return Response.json({
    listing_id: created.id,
    rail: rail.id,
    model: model.canonical,
    price_micro_per_mtok: price === null ? null : price.toString(),
    capacity_tokens: capacityTokens.toString(),
    status: "active",
  });
}
