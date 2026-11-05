import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../lib/db.ts";
import { listings } from "../../../../../lib/schema.ts";
import { routerKey } from "../../../../../lib/auth.ts";
import { catalog, railPricing, reference } from "../../../../../lib/rails.ts";
import {
  charge,
  estimatePromptTokens,
  formatMicroPerMtok,
  marketPrice,
  mixedTokens,
  railCost,
  reservation,
  sellerEarning,
} from "../../../../../lib/price.ts";
import { open } from "../../../../../lib/secrets.ts";
import { release, reserve, settle } from "../../../../../lib/ledger.ts";
import type { Pricing, Rail, RailId, RouterError, RouterErrorCode } from "../../../../../lib/types";

export const maxDuration = 300;

const bodySchema = z
  .object({
    model: z.string().min(1).optional(),
    messages: z.array(z.unknown()).min(1),
    max_tokens: z.number().int().positive().max(32768).optional(),
    max_completion_tokens: z.number().int().positive().max(32768).optional(),
    stream: z.boolean().optional(),
  })
  .passthrough();

const ERROR_TYPES: Record<RouterErrorCode, RouterError["error"]["type"]> = {
  invalid_api_key: "authentication_error",
  insufficient_balance: "payment_error",
  approval_required: "permission_error",
  model_not_found: "invalid_request_error",
  no_liquidity: "invalid_request_error",
  invalid_request: "invalid_request_error",
  upstream_failed: "server_error",
};

function fail(status: number, code: RouterErrorCode, message: string): Response {
  const body: RouterError = { error: { message, type: ERROR_TYPES[code], code } };
  return Response.json(body, { status });
}

type Candidate = { id: string; rail: Rail; pricing: Pricing; credential: string; ask: bigint };

export async function POST(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid request body");
  const body = parsed.data;

  if (body.stream === true) return fail(400, "invalid_request", "streaming is not enabled yet");

  const model = body.model ?? key.defaultModel;
  if (!model) return fail(400, "invalid_request", "model is required");

  const ref = await reference(model);
  if (!ref) return fail(404, "model_not_found", `unknown model: ${model}`);

  const rails = new Map((await catalog()).map((rail) => [rail.id, rail]));
  const rows = await db()
    .select({
      id: listings.id,
      rail: listings.rail,
      price: listings.priceMicroPerMtok,
      credential: listings.credentialCiphertext,
    })
    .from(listings)
    .where(
      and(
        eq(listings.model, model),
        eq(listings.status, "active"),
        or(isNull(listings.throttledUntil), lt(listings.throttledUntil, new Date())),
      ),
    );

  const bestLimit = rows.reduce<bigint | null>((best, row) => {
    if (row.price === null) return best;
    return best === null || row.price < best ? row.price : best;
  }, null);

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const rail = rails.get(row.rail as RailId);
    if (!rail) continue;
    const pricing = rail.models.find((entry) => entry.canonical === model);
    if (!pricing) continue;
    const ask = row.price ?? marketPrice(bestLimit, ref.pricing, rail);
    if (ask === null) continue;
    candidates.push({
      id: row.id,
      rail,
      pricing: { prompt: pricing.listPrompt, completion: pricing.listCompletion },
      credential: row.credential,
      ask,
    });
  }
  candidates.sort((a, b) => (a.ask < b.ask ? -1 : a.ask > b.ask ? 1 : 0));

  if (candidates.length === 0) return fail(404, "no_liquidity", `no asks for ${model}`);

  const promptBytes = new TextEncoder().encode(JSON.stringify(body.messages)).length;
  const maxTokens = BigInt(body.max_tokens ?? body.max_completion_tokens ?? 4096);
  const takeBps = BigInt(process.env.TAKE_BPS ?? "1000");

  for (const candidate of candidates.slice(0, 3)) {
    const hold = reservation(candidate.ask, promptBytes, maxTokens);
    const reserved = await reserve({
      keyId: key.id,
      listingId: candidate.id,
      rail: candidate.rail.id,
      price: candidate.ask,
      tokens: hold.tokens,
      micro: hold.micro,
    });

    if (!reserved.listingOk) continue;
    if (!reserved.keyOk || !reserved.usageId) {
      return fail(402, "insufficient_balance", `top up at least ${hold.micro} micro USD`);
    }

    const usageId = reserved.usageId;
    let response: Response;
    try {
      response = await fetchUpstream(candidate, model, body);
    } catch {
      await release(usageId);
      continue;
    }

    if (!response.ok) {
      await release(usageId);
      if (response.status === 401 || response.status === 403) {
        await db().update(listings).set({ status: "invalid" }).where(eq(listings.id, candidate.id));
        continue;
      }
      if (response.status === 402) {
        await db().update(listings).set({ status: "exhausted" }).where(eq(listings.id, candidate.id));
        continue;
      }
      if (response.status === 429) {
        const header = Number(response.headers.get("retry-after") ?? "60");
        const seconds = Number.isFinite(header) && header > 0 ? header : 60;
        await db()
          .update(listings)
          .set({ throttledUntil: new Date(Date.now() + seconds * 1000) })
          .where(eq(listings.id, candidate.id));
        continue;
      }
      if (response.status >= 500) continue;
      const detail = (await response.text()).slice(0, 300);
      return fail(502, "upstream_failed", detail || `upstream ${response.status}`);
    }

    const payload = (await response.json()) as {
      id?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const promptTokens = BigInt(payload.usage?.prompt_tokens ?? Number(estimatePromptTokens(promptBytes)));
    const completionTokens = BigInt(payload.usage?.completion_tokens ?? 0);
    const actual = mixedTokens(promptTokens, completionTokens);
    const chargeMicro = charge(actual, candidate.ask);

    await settle({
      usageId,
      promptTokens,
      completionTokens,
      mixedTokens: actual,
      listCostMicro: railCost(candidate.pricing, promptTokens, completionTokens),
      chargeMicro,
      sellerEarningMicro: sellerEarning(chargeMicro, takeBps),
      upstreamRequestId: payload.id ?? null,
    });

    return Response.json(payload);
  }

  return fail(502, "upstream_failed", "all candidates failed");
}

async function fetchUpstream(
  candidate: Candidate,
  model: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${open(candidate.credential)}`,
    ...candidate.rail.extraHeaders,
  };
  if (candidate.rail.id === "0g") {
    headers["X-0G-Provider-Trust-Mode"] = "verified";
    headers["X-0G-Provider-Max-Price-Usd-Prompt"] = formatMicroPerMtok(candidate.pricing.prompt);
    headers["X-0G-Provider-Max-Price-Usd-Completion"] = formatMicroPerMtok(candidate.pricing.completion);
  }
  const upstreamModel = candidate.rail.models.find((entry) => entry.canonical === model)?.upstream ?? model;
  return fetch(`${candidate.rail.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, model: upstreamModel, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
}
