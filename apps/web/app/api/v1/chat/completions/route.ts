import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { routerKey } from "../../../../../lib/auth.ts";
import { asks, byCheapest } from "../../../../../lib/book.ts";
import { db } from "../../../../../lib/db.ts";
import { fail } from "../../../../../lib/errors.ts";
import { release, reserve, reservePrepaid, settle, type SettleInput } from "../../../../../lib/ledger.ts";
import {
  charge,
  estimatePromptTokens,
  formatMicroPerMtok,
  mixedTokens,
  railCost,
  reservation,
  sellerEarning,
} from "../../../../../lib/price.ts";
import { catalog, reference } from "../../../../../lib/rails.ts";
import { listings, prepaid } from "../../../../../lib/schema.ts";
import { open } from "../../../../../lib/secrets.ts";
import { applyPayment, paymentDue } from "../../../../../lib/x402.ts";
import type { Pricing, Rail } from "../../../../../lib/types";

export const maxDuration = 300;

const DEADLINE_MS = (maxDuration - 20) * 1000;
const HEADER_TIMEOUT_MS = 120_000;
const SPOT_CANDIDATES = 3;

const bodySchema = z
  .object({
    model: z.string().min(1).optional(),
    messages: z.array(z.unknown()).min(1),
    max_tokens: z.number().int().positive().max(32768).optional(),
    max_completion_tokens: z.number().int().positive().max(32768).optional(),
    stream: z.boolean().optional(),
    stream_options: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
});

const replySchema = z.object({
  id: z.string().optional(),
  usage: usageSchema.nullish(),
  x_0g_trace: z.object({ request_id: z.string().optional() }).nullish(),
  choices: z.array(z.object({ delta: z.unknown().optional(), message: z.unknown().optional() })).nullish(),
});

const upstreamErrorSchema = z.object({
  error: z.object({ message: z.string(), type: z.string().optional(), code: z.string().optional() }),
});

type Body = z.infer<typeof bodySchema>;
type Usage = z.infer<typeof usageSchema>;
type Seen = { usage: Usage | null; upstreamId: string | null; forwardedBytes: number };

type Candidate = {
  model: string;
  listingId: string;
  rail: Rail;
  upstream: string;
  pricing: Pricing;
  credential: string;
  ask: bigint;
  prepaidId: string | null;
};

type Attempt = {
  request: Request;
  candidate: Candidate;
  body: Body;
  maxTokens: number;
  usageId: string;
  holdTokens: bigint;
  promptBytes: number;
  started: number;
  headers: Record<string, string>;
};

const encoder = new TextEncoder();

function textBytes(value: unknown): number {
  if (typeof value === "string") return encoder.encode(value).length;
  if (Array.isArray(value)) return value.reduce<number>((total, item: unknown) => total + textBytes(item), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce<number>((total, item: unknown) => total + textBytes(item), 0);
  }
  return 0;
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid request body");
  const body = parsed.data;

  const requested = body.model ?? key.defaultModel;
  if (!requested) return fail(400, "invalid_request", "model is required");
  const shortlist = requested.startsWith("cheapest:")
    ? requested.slice("cheapest:".length).split(",").map((id) => id.trim()).filter(Boolean)
    : null;
  if (shortlist?.length === 0) return fail(400, "invalid_request", "cheapest: needs at least one model");
  const known: string[] = [];
  for (const id of shortlist ? byCheapest(await asks(null), shortlist) : [requested]) {
    if (await reference(id)) known.push(id);
  }
  if (known.length === 0) return fail(404, "model_not_found", `unknown model: ${requested}`);

  const payment = await applyPayment(request, key);
  if ("error" in payment) return payment.error;
  const headers: Record<string, string> = payment.header ? { "PAYMENT-RESPONSE": payment.header } : {};

  const candidates = (await Promise.all(known.map((id) => candidatesFor(key.id, id)))).flat();
  if (candidates.length === 0) return fail(404, "no_liquidity", `no asks for ${requested}`);

  const promptBytes = encoder.encode(JSON.stringify(body.messages)).length;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? 4096;

  for (const candidate of candidates) {
    const hold = reservation(candidate.ask, promptBytes, BigInt(maxTokens));
    let usageId: string | null;
    if (candidate.prepaidId) {
      usageId = await reservePrepaid({
        keyId: key.id,
        prepaidId: candidate.prepaidId,
        rail: candidate.rail.id,
        tokens: hold.tokens,
      });
    } else {
      const reserved = await reserve({
        keyId: key.id,
        listingId: candidate.listingId,
        rail: candidate.rail.id,
        price: candidate.ask,
        tokens: hold.tokens,
        micro: hold.micro,
      });
      if (reserved.listingOk && !reserved.keyOk) {
        return (
          (await paymentDue(request, key.id, hold.micro)) ??
          fail(402, "insufficient_balance", "the balance changed while reserving; retry")
        );
      }
      usageId = reserved.usageId;
    }
    if (!usageId) continue;

    if (shortlist) headers["X-Router-Model"] = candidate.model;
    const outcome = await attempt({
      request,
      candidate,
      body,
      maxTokens,
      usageId,
      holdTokens: hold.tokens,
      promptBytes,
      started,
      headers,
    });
    if (outcome && !(shortlist && outcome.status === 404)) return outcome;
  }

  return fail(502, "upstream_failed", "every candidate failed");
}

async function candidatesFor(keyId: string, model: string): Promise<Candidate[]> {
  const now = new Date();
  const rails = new Map<string, Rail>((await catalog()).map((rail) => [rail.id, rail]));
  const held = await db()
    .select({
      prepaidId: prepaid.id,
      listingId: listings.id,
      rail: listings.rail,
      credential: listings.credentialCiphertext,
    })
    .from(prepaid)
    .innerJoin(listings, eq(prepaid.listingId, listings.id))
    .where(
      and(
        eq(prepaid.keyId, keyId),
        eq(prepaid.model, model),
        gt(prepaid.tokensRemaining, 0n),
        or(isNull(prepaid.expiresAt), gt(prepaid.expiresAt, now)),
        inArray(listings.status, ["active", "exhausted", "cancelled"]),
        or(isNull(listings.throttledUntil), lt(listings.throttledUntil, now)),
      ),
    )
    .orderBy(sql`${prepaid.expiresAt} asc nulls last`, prepaid.createdAt);

  const fromPrepaid: Candidate[] = [];
  for (const row of held) {
    const rail = rails.get(row.rail);
    const entry = rail?.models.find((candidate) => candidate.canonical === model);
    if (!rail || !entry) continue;
    fromPrepaid.push({
      model,
      listingId: row.listingId,
      rail,
      upstream: entry.upstream,
      pricing: { prompt: entry.listPrompt, completion: entry.listCompletion },
      credential: row.credential,
      ask: 0n,
      prepaidId: row.prepaidId,
    });
  }

  const spot: Candidate[] = (await asks(model)).slice(0, SPOT_CANDIDATES).map((ask) => ({
    model,
    listingId: ask.listingId,
    rail: ask.rail,
    upstream: ask.upstream,
    pricing: ask.pricing,
    credential: ask.credential,
    ask: ask.price,
    prepaidId: null,
  }));

  return [...fromPrepaid, ...spot];
}

async function attempt(input: Attempt): Promise<Response | null> {
  const { request, candidate, usageId } = input;
  const controller = new AbortController();
  const seen: Seen = { usage: null, upstreamId: null, forwardedBytes: 0 };
  const onClientGone = () => controller.abort("client");
  const headerTimer = setTimeout(() => controller.abort("headers"), HEADER_TIMEOUT_MS);
  const deadline = setTimeout(
    () => {
      controller.abort("deadline");
      void finish();
    },
    Math.max(0, input.started + DEADLINE_MS - Date.now()),
  );

  let closed = false;
  const close = () => {
    closed = true;
    clearTimeout(headerTimer);
    clearTimeout(deadline);
    request.signal.removeEventListener("abort", onClientGone);
  };
  const finish = async (): Promise<void> => {
    if (closed) return;
    close();
    try {
      await settle(settlement(input, seen));
    } catch (error) {
      console.error("settle failed; the keeper sweep will release the hold", usageId, error);
    }
  };
  const giveBack = async (): Promise<void> => {
    if (closed) return;
    close();
    await release(usageId);
  };

  if (request.signal.aborted) controller.abort("client");
  request.signal.addEventListener("abort", onClientGone, { once: true });

  let response: Response;
  try {
    response = await fetchUpstream(
      candidate,
      upstreamPayload(input.body, candidate.upstream, input.maxTokens, candidate.rail.maxTokensField ?? "max_tokens"),
      controller.signal,
    );
  } catch {
    const reason: unknown = controller.signal.reason;
    if (reason === "client" || reason === "deadline") {
      await finish();
      return fail(502, "upstream_failed", "the request ended before the upstream answered");
    }
    await giveBack();
    return null;
  }
  clearTimeout(headerTimer);

  if (!response.ok) {
    await giveBack();
    return rejected(candidate, response);
  }

  if (input.body.stream === true) {
    if (!response.body) {
      await finish();
      return fail(502, "upstream_failed", "the upstream sent an empty stream");
    }
    return streamed(response.body, seen, finish, () => controller.abort("client"), input.headers);
  }

  try {
    const payload: unknown = await response.json();
    const reply = replySchema.safeParse(payload);
    if (reply.success) {
      seen.usage = reply.data.usage ?? null;
      seen.upstreamId = reply.data.x_0g_trace?.request_id ?? reply.data.id ?? null;
      seen.forwardedBytes = (reply.data.choices ?? []).reduce((total, choice) => total + textBytes(choice.message), 0);
    }
    await finish();
    return Response.json(payload, { headers: input.headers });
  } catch {
    await finish();
    return fail(502, "upstream_failed", "the upstream response was cut off");
  }
}

function settlement(input: Attempt, seen: Seen): SettleInput {
  const { candidate } = input;
  const promptTokens = seen.usage ? BigInt(seen.usage.prompt_tokens) : estimatePromptTokens(input.promptBytes);
  const completionTokens = seen.usage
    ? BigInt(seen.usage.completion_tokens)
    : BigInt(Math.ceil(seen.forwardedBytes / 4));
  const counted = mixedTokens(promptTokens, completionTokens);
  const tokens = seen.usage || counted < input.holdTokens ? counted : input.holdTokens;
  const chargeMicro = charge(tokens, candidate.ask);
  return {
    usageId: input.usageId,
    promptTokens,
    completionTokens,
    mixedTokens: tokens,
    listCostMicro: railCost(candidate.pricing, promptTokens, completionTokens),
    chargeMicro,
    sellerEarningMicro: sellerEarning(chargeMicro, BigInt(process.env.TAKE_BPS ?? "1000")),
    upstreamRequestId: seen.upstreamId ? `${candidate.rail.id}:${seen.upstreamId}` : null,
  };
}

function upstreamPayload(
  body: Body,
  upstream: string,
  maxTokens: number,
  field: "max_tokens" | "max_completion_tokens",
): Record<string, unknown> {
  const { stream_options: streamOptions, max_tokens: _maxTokens, max_completion_tokens: _maxCompletion, ...rest } = body;
  const limit = field === "max_completion_tokens" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
  if (body.stream === true) {
    return { ...rest, ...limit, model: upstream, stream: true, stream_options: { ...streamOptions, include_usage: true } };
  }
  return { ...rest, ...limit, model: upstream, stream: false };
}

function fetchUpstream(candidate: Candidate, payload: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
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
  if (candidate.rail.id === "opencode-go") headers["x-opencode-session"] = randomUUID();
  return fetch(`${candidate.rail.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}

async function rejected(candidate: Candidate, response: Response): Promise<Response | null> {
  const { status } = response;
  if (status === 401) {
    await response.body?.cancel().catch(() => undefined);
    await db().update(listings).set({ status: "invalid" }).where(eq(listings.id, candidate.listingId));
    return null;
  }
  if (status === 402) {
    await response.body?.cancel().catch(() => undefined);
    await db().update(listings).set({ status: "exhausted" }).where(eq(listings.id, candidate.listingId));
    return null;
  }
  if (status === 429) {
    await response.body?.cancel().catch(() => undefined);
    const retryAfter = Number(response.headers.get("retry-after"));
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
    await db()
      .update(listings)
      .set({ throttledUntil: new Date(Date.now() + seconds * 1000) })
      .where(eq(listings.id, candidate.listingId));
    return null;
  }
  if (status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const error = await upstreamError(response);
  if (status === 403) {
    if (error.code === "upgrade_required" || error.type === "authentication_error") {
      await db().update(listings).set({ status: "invalid" }).where(eq(listings.id, candidate.listingId));
      return null;
    }
    return fail(400, "invalid_request", error.message);
  }
  return status === 404 ? fail(404, "model_not_found", error.message) : fail(400, "invalid_request", error.message);
}

type UpstreamError = { message: string; type: string; code: string };

async function upstreamError(response: Response): Promise<UpstreamError> {
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const shaped = upstreamErrorSchema.safeParse(parsed);
  if (shaped.success) {
    return {
      message: shaped.data.error.message.slice(0, 300),
      type: shaped.data.error.type ?? "",
      code: shaped.data.error.code ?? "",
    };
  }
  return { message: text.slice(0, 300) || `upstream returned ${response.status}`, type: "", code: "" };
}

function streamed(
  source: ReadableStream<Uint8Array>,
  seen: Seen,
  finish: () => Promise<void>,
  stop: () => void,
  headers: Record<string, string>,
): Response {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const scan = (text: string) => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const chunk = replySchema.safeParse(json);
      if (!chunk.success) continue;
      seen.upstreamId = chunk.data.x_0g_trace?.request_id ?? seen.upstreamId ?? chunk.data.id ?? null;
      if (chunk.data.usage) seen.usage = chunk.data.usage;
      for (const choice of chunk.data.choices ?? []) seen.forwardedBytes += textBytes(choice.delta);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finish();
          controller.close();
          return;
        }
        scan(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (error) {
        await finish();
        controller.error(error);
      }
    },
    async cancel() {
      stop();
      await finish();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...headers },
  });
}
