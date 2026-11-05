import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST } from "../app/api/v1/chat/completions/route.ts";
import { hashKey } from "./auth.ts";
import { db } from "./db.ts";
import { keys, listings, sellers, usage } from "./schema.ts";
import { seal } from "./secrets.ts";

const hasDb = Boolean(process.env.DATABASE_URL && process.env.SECRETS_KEY);
const skip = hasDb ? false : "DATABASE_URL and SECRETS_KEY required";
const suffix = randomBytes(4).toString("hex");

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row;
}

const models = [
  "glm-5.3",
  "deepseek-v4.1-flash",
  "claude-opus-5.5",
  "gpt-6-sol",
  "z-ai/glm-5.3",
  "deepseek/deepseek-v4.1-flash",
  "anthropic/claude-opus-5.5",
  "openai/gpt-6-sol",
];
const pricing = { prompt: "0.0000014", completion: "0.0000044" };

let server: Server;
let mode: "ok" | "fail" = "ok";
let sequence = 0;
let sellerId = "";
let listingId = "";
const keyIds: string[] = [];
let goodKey = "";
let poorKey = "";
let failKey = "";

before(async () => {
  if (!hasDb) return;
  server = createServer((request, response) => {
    if (request.url?.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, pricing_usd: pricing, pricing })) }));
      return;
    }
    if (request.url?.endsWith("/chat/completions")) {
      request.resume();
      request.on("end", () => {
        if (mode === "fail") {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "boom" } }));
          return;
        }
        sequence += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: `chatcmpl-${suffix}-${sequence}`,
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
      });
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  process.env.STUB_RAIL_URL = base;
  process.env.OG_ROUTER_URL = base;
  process.env.OPENROUTER_BASE_URL = base;

  const d = db();
  const seller = first(
    await d
      .insert(sellers)
      .values({ address: `0x${suffix}`, worldNullifier: `${Date.now()}` })
      .returning(),
  );
  sellerId = seller.id;

  const listing = first(
    await d
      .insert(listings)
      .values({
        sellerId,
        rail: "stub",
        model: "glm-5.3",
        authKind: "key",
        credentialCiphertext: seal("sk-stub"),
        priceMicroPerMtok: 1_500_000n,
        capacityTokens: 1_000_000n,
        status: "active",
        clientNonce: `probe-${suffix}`,
      })
      .returning(),
  );
  listingId = listing.id;

  goodKey = `rk_${randomBytes(24).toString("base64url")}`;
  poorKey = `rk_${randomBytes(24).toString("base64url")}`;
  failKey = `rk_${randomBytes(24).toString("base64url")}`;
  const inserted = await d
    .insert(keys)
    .values([
      { hash: hashKey(goodKey), balanceUsdMicro: 1_000_000n },
      { hash: hashKey(poorKey), balanceUsdMicro: 1n },
      { hash: hashKey(failKey), balanceUsdMicro: 1_000_000n },
    ])
    .returning();
  keyIds.push(...inserted.map((row) => row.id));
});

after(async () => {
  if (!hasDb) return;
  server?.close();
  if (!listingId) return;
  const d = db();
  await d.delete(usage).where(eq(usage.listingId, listingId));
  await d.delete(listings).where(eq(listings.id, listingId));
  await d.delete(keys).where(eq(keys.id, keyIds[0] ?? ""));
  await d.delete(keys).where(eq(keys.id, keyIds[1] ?? ""));
  await d.delete(keys).where(eq(keys.id, keyIds[2] ?? ""));
  await d.delete(sellers).where(eq(sellers.id, sellerId));
});

function call(key: string, body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const message = { model: "glm-5.3", messages: [{ role: "user", content: "ping" }], max_tokens: 16 };

test("settles exactly once and charges the mixed-token price", { skip }, async () => {
  mode = "ok";
  const response = await call(goodKey, message);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  assert.equal(payload.choices?.[0]?.message?.content, "pong");

  const d = db();
  const row = first(await d.select().from(usage).where(eq(usage.keyId, keyIds[0] ?? "")).limit(1));
  assert.equal(row.status, "settled");
  assert.equal(row.promptTokens, 10);
  assert.equal(row.completionTokens, 5);
  assert.equal(row.mixedTokens, 9n);
  assert.equal(row.chargeUsdMicro, 14n);

  const key = first(await d.select().from(keys).where(eq(keys.id, keyIds[0] ?? "")).limit(1));
  assert.equal(key.balanceUsdMicro, 1_000_000n - 14n);
  assert.equal(key.reservedUsdMicro, 0n);

  const settledListing = first(await d.select().from(listings).where(eq(listings.id, listingId)).limit(1));
  assert.equal(settledListing.usedTokens, 9n);
  assert.equal(settledListing.reservedTokens, 0n);
});

test("rejects an unknown key without writing a row", { skip }, async () => {
  const before = await db().select().from(usage).where(eq(usage.listingId, listingId));
  const response = await call("rk_unknown", message);
  assert.equal(response.status, 401);
  const after = await db().select().from(usage).where(eq(usage.listingId, listingId));
  assert.equal(after.length, before.length);
});

test("refuses when the balance cannot cover the hold", { skip }, async () => {
  const response = await call(poorKey, { ...message, max_tokens: undefined });
  assert.equal(response.status, 402);
  const payload = (await response.json()) as { error?: { code?: string } };
  assert.equal(payload.error?.code, "insufficient_balance");
  const afterHold = first(await db().select().from(listings).where(eq(listings.id, listingId)).limit(1));
  assert.equal(afterHold.reservedTokens, 0n);
});

test("releases the hold when the upstream fails", { skip }, async () => {
  mode = "fail";
  const response = await call(failKey, message);
  assert.equal(response.status, 502);

  const d = db();
  const row = first(await d.select().from(usage).where(eq(usage.keyId, keyIds[2] ?? "")).limit(1));
  assert.equal(row.status, "released");

  const key = first(await d.select().from(keys).where(eq(keys.id, keyIds[2] ?? "")).limit(1));
  assert.equal(key.balanceUsdMicro, 1_000_000n);
  assert.equal(key.reservedUsdMicro, 0n);

  const releasedListing = first(await d.select().from(listings).where(eq(listings.id, listingId)).limit(1));
  assert.equal(releasedListing.reservedTokens, 0n);
  mode = "ok";
});
