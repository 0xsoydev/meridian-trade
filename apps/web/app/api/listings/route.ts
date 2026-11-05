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

type Probe = { ok: true } | { ok: false; status: number; message: string };

async function probeKey(rail: Rail, key: string): Promise<Probe> {
  const headers = { authorization: `Bearer ${key}`, ...rail.extraHeaders };
  try {
    if (rail.id === "0g") {
      const response = await fetch(`${rail.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          model: "__probe__",
          messages: [{ role: "user", content: "." }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return { ok: true };
      return { ok: false, status: response.status, message: "0g probe did not answer model_not_found" };
    }

    const path = rail.id === "openrouter" ? "/key" : "/models";
    const response = await fetch(`${rail.baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true };
    return { ok: false, status: response.status, message: `credential probe answered ${response.status}` };
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

  const probe = await probeKey(rail, credential.key);
  if (!probe.ok) {
    return probe.status === 401 || probe.status === 403
      ? fail(401, "invalid_api_key", "credential rejected by the rail")
      : fail(502, "upstream_failed", probe.message);
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
