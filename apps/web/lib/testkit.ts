import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { hashKey } from "./auth.ts";
import { db } from "./db.ts";
import { approvals, bids, keys, listings, offers, prepaid, sellers, topups, trades, usage } from "./schema.ts";
import { seal } from "./secrets.ts";

process.env.NEXT_PUBLIC_WORLD_BYPASS = "false";
process.env.COMMANDCODE_BASE_URL = "http://127.0.0.1:1";
process.env.OG_MODELS_URL = "http://127.0.0.1:1/models";

export const hasDb = Boolean(process.env.DATABASE_URL && process.env.SECRETS_KEY);
export const skip = hasDb ? false : "DATABASE_URL and SECRETS_KEY required";
export const suffix = randomBytes(4).toString("hex");

export type ChatCall = { auth: string; session: string; body: Record<string, unknown> };
export type StubUsage = { prompt_tokens: number; completion_tokens: number };

const bodySchema = z.record(z.string(), z.unknown());
const PRICING = { prompt: "0.0000014", completion: "0.0000044" };

export async function stubRail(
  models: string[],
  onChat: (call: ChatCall, response: ServerResponse) => void,
): Promise<{ calls: ChatCall[]; close: () => void }> {
  const calls: ChatCall[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      if (request.url?.endsWith("/models")) {
        const auth = request.headers.authorization ?? "";
        if (auth === "Bearer sk-bad") {
          response.writeHead(401).end();
          return;
        }
        const listed = auth === "Bearer sk-narrow" ? models.slice(-1) : models;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: listed.map((id) => ({ id, pricing_usd: PRICING })) }));
        return;
      }
      if (request.url?.endsWith("/chat/completions")) {
        const call = {
          auth: request.headers.authorization ?? "",
          session: String(request.headers["x-opencode-session"] ?? ""),
          body: bodySchema.parse(JSON.parse(raw)),
        };
        calls.push(call);
        onChat(call, response);
        return;
      }
      response.writeHead(404).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.STUB_RAIL_URL = url;
  process.env.OG_ROUTER_URL = url;
  process.env.OG_MODELS_URL = `${url}/models`;
  process.env.OPENROUTER_BASE_URL = url;
  return {
    calls,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

export function reply(response: ServerResponse, id: string, usage: StubUsage = { prompt_tokens: 10, completion_tokens: 5 }): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id,
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
      usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
    }),
  );
}

export function status(response: ServerResponse, code: number, headers: Record<string, string> = {}): void {
  response.writeHead(code, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify({ error: { message: `stub ${code}` } }));
}

export function errorJson(response: ServerResponse, code: number, body: unknown): void {
  response.writeHead(code, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function chunks(id: string, words: string[], usage: StubUsage | null): unknown[] {
  const list: unknown[] = [{ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }];
  for (const word of words) list.push({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: word } }] });
  list.push({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  if (usage) {
    list.push({
      id,
      object: "chat.completion.chunk",
      choices: [],
      usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
    });
  }
  return list;
}

export async function sse(response: ServerResponse, list: unknown[], gapMs = 0): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of list) {
    if (response.destroyed) return;
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  if (!response.destroyed) response.end("data: [DONE]\n\n");
}

export function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected a row");
  return row;
}

const made = { sellers: new Set<string>(), listings: new Set<string>(), keys: new Set<string>() };

export async function makeSeller(): Promise<string> {
  const row = first(
    await db()
      .insert(sellers)
      .values({
        address: `0x${randomBytes(20).toString("hex")}`,
        worldNullifier: BigInt(`0x${randomBytes(16).toString("hex")}`).toString(),
      })
      .returning({ id: sellers.id }),
  );
  made.sellers.add(row.id);
  return row.id;
}

export async function makeListing(input: {
  sellerId: string;
  model: string;
  credential: string;
  price: bigint | null;
  capacity: bigint;
  rail?: string;
}): Promise<string> {
  const row = first(
    await db()
      .insert(listings)
      .values({
        sellerId: input.sellerId,
        rail: input.rail ?? "stub",
        model: input.model,
        authKind: "key",
        credentialCiphertext: seal(input.credential),
        priceMicroPerMtok: input.price,
        capacityTokens: input.capacity,
        status: "active",
        clientNonce: `test-${randomBytes(8).toString("hex")}`,
      })
      .returning({ id: listings.id }),
  );
  made.listings.add(row.id);
  return row.id;
}

export async function makeKey(
  balance: bigint,
  settings: { autoTopup?: bigint; cap?: bigint } = {},
): Promise<{ id: string; raw: string }> {
  const raw = `rk_${randomBytes(24).toString("base64url")}`;
  const row = first(
    await db()
      .insert(keys)
      .values({
        hash: hashKey(raw),
        balanceUsdMicro: balance,
        autoTopupUsdMicro: settings.autoTopup ?? 0n,
        dailyTopupCapUsdMicro: settings.cap ?? 5_000_000n,
      })
      .returning({ id: keys.id }),
  );
  made.keys.add(row.id);
  return { id: row.id, raw };
}

export function adoptKey(id: string): void {
  made.keys.add(id);
}

export async function cleanup(): Promise<void> {
  const d = db();
  const keyIds = [...made.keys];
  const listingIds = [...made.listings];
  const sellerIds = [...made.sellers];
  if (keyIds.length > 0) {
    await d.delete(offers).where(inArray(offers.keyId, keyIds));
    await d.delete(usage).where(inArray(usage.keyId, keyIds));
    await d.delete(prepaid).where(inArray(prepaid.keyId, keyIds));
    await d.delete(trades).where(inArray(trades.keyId, keyIds));
    await d.delete(trades).where(inArray(trades.sellerKeyId, keyIds));
    await d.delete(topups).where(inArray(topups.keyId, keyIds));
    await d.delete(bids).where(inArray(bids.keyId, keyIds));
  }
  if (listingIds.length > 0) {
    await d.delete(offers).where(inArray(offers.listingId, listingIds));
    await d.delete(usage).where(inArray(usage.listingId, listingIds));
    await d.delete(prepaid).where(inArray(prepaid.listingId, listingIds));
    await d.delete(trades).where(inArray(trades.listingId, listingIds));
    await d.delete(listings).where(inArray(listings.id, listingIds));
  }
  if (keyIds.length > 0) await d.delete(approvals).where(inArray(approvals.keyId, keyIds));
  if (keyIds.length > 0) await d.delete(keys).where(inArray(keys.id, keyIds));
  if (sellerIds.length > 0) await d.delete(sellers).where(inArray(sellers.id, sellerIds));
}

export function jsonRequest(url: string, key: string | null, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
}
