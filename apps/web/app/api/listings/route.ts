import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { expectedHost, verifySigned } from "../../../lib/auth.ts";
import { matchBids } from "../../../lib/bids.ts";
import { db } from "../../../lib/db.ts";
import { fail } from "../../../lib/errors.ts";
import { listingPriceError, parseCapacityMtok } from "../../../lib/listings.ts";
import { catalog } from "../../../lib/rails.ts";
import { listings, sellers } from "../../../lib/schema.ts";
import { open, seal } from "../../../lib/secrets.ts";
import type { Rail, SellerListings } from "../../../lib/types";

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
      z.object({ kind: z.literal("stored"), listing_id: z.uuid() }).strict(),
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

async function storedKey(listingId: string, sellerId: string, railId: string): Promise<string | null> {
  const [source] = await db()
    .select({ rail: listings.rail, authKind: listings.authKind, sealed: listings.credentialCiphertext })
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)))
    .limit(1);
  if (!source || source.rail !== railId || source.authKind !== "key") return null;
  try {
    return open(source.sealed);
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const address = (new URL(request.url).searchParams.get("seller") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return fail(400, "invalid_request", "seller must be a wallet address");

  const [seller] = await db().select({ id: sellers.id }).from(sellers).where(eq(sellers.address, address)).limit(1);
  const rows = seller
    ? await db()
        .select({
          id: listings.id,
          rail: listings.rail,
          model: listings.model,
          price: listings.priceMicroPerMtok,
          capacity: listings.capacityTokens,
          used: listings.usedTokens,
          reserved: listings.reservedTokens,
          status: listings.status,
        })
        .from(listings)
        .where(eq(listings.sellerId, seller.id))
        .orderBy(desc(listings.createdAt))
        .limit(200)
    : [];

  const result: SellerListings = {
    verified: seller !== undefined,
    listings: rows.map((row) => ({
      listing_id: row.id,
      rail: row.rail,
      model: row.model,
      price_micro_per_mtok: row.price === null ? null : row.price.toString(),
      capacity_tokens: row.capacity.toString(),
      used_tokens: row.used.toString(),
      reserved_tokens: row.reserved.toString(),
      status: row.status,
    })),
  };
  return Response.json(result);
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
  if (!seller) return fail(403, "invalid_request", "this wallet is not a verified seller yet; verify it once with World ID on /sell");

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
  if (credential.kind === "oauth") return fail(400, "invalid_request", "oauth rails are disabled");
  if (rail.auth !== "key") return fail(400, "invalid_request", "rail does not accept api keys");

  const key = credential.kind === "key" ? credential.key : await storedKey(credential.listing_id, seller.id, rail.id);
  if (key === null) return fail(404, "invalid_request", `no stored ${rail.id} key on that listing`);

  const probe = await probeKey(rail, model.upstream, key);
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
      credentialCiphertext: seal(key),
      priceMicroPerMtok: price,
      capacityTokens,
      status: "active",
      clientNonce: intent.data.client_nonce,
    })
    .onConflictDoNothing({ target: listings.clientNonce })
    .returning({ id: listings.id });

  if (!created) return fail(409, "invalid_request", "client_nonce has already been used");
  await matchBids(model.canonical).catch(() => 0);

  return Response.json({
    listing_id: created.id,
    rail: rail.id,
    model: model.canonical,
    price_micro_per_mtok: price === null ? null : price.toString(),
    capacity_tokens: capacityTokens.toString(),
    status: "active",
  });
}
