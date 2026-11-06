import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST } from "../app/api/v1/chat/completions/route.ts";
import { db } from "./db.ts";
import { keys, listings, usage } from "./schema.ts";
import { estimatePromptTokens } from "./price.ts";
import {
  chunks,
  cleanup,
  errorJson,
  first,
  hasDb,
  jsonRequest,
  makeKey,
  makeListing,
  makeSeller,
  reply,
  skip,
  sse,
  status,
  stubRail,
  suffix,
  type ChatCall,
} from "./testkit.ts";

const name = (label: string) => `t-${suffix}-${label}`;
const MODEL = {
  basic: name("basic"),
  poor: name("poor"),
  fail: name("fail"),
  stream: name("stream"),
  cancel: name("cancel"),
  failover: name("failover"),
  shortCheap: name("short-cheap"),
  shortNext: name("short-next"),
  throttle: name("throttle"),
  policy: name("policy"),
  upgrade: name("upgrade"),
};
const CHAT_URL = "http://localhost/api/v1/chat/completions";
const ping = [{ role: "user", content: "ping" }];

let rail: { calls: ChatCall[]; close: () => void } | null = null;
let sellerId = "";
let sequence = 0;

before(async () => {
  if (!hasDb) return;
  const priced = [
    "anthropic/claude-opus-5.5",
    "anthropic/claude-sonnet-5.5",
    "openai/gpt-6-sol",
    "openai/gpt-6.1-terra",
    "z-ai/glm-5.3",
    "deepseek/deepseek-v4.1-flash",
  ];
  rail = await stubRail([...Object.values(MODEL), ...priced], (call, response) => {
    sequence += 1;
    const id = `chatcmpl-${suffix}-${sequence}`;
    if (call.auth === "Bearer sk-500") return status(response, 500);
    if (call.auth === "Bearer sk-429") return status(response, 429, { "retry-after": "120" });
    if (call.auth === "Bearer sk-401") return status(response, 401);
    if (call.auth === "Bearer sk-403-policy") {
      return errorJson(response, 403, {
        error: { message: "content policy refused", type: "invalid_request_error", code: "content_policy_refused" },
      });
    }
    if (call.auth === "Bearer sk-403-upgrade") {
      return errorJson(response, 403, {
        error: { message: "this plan has no API access", type: "permission_error", code: "upgrade_required" },
      });
    }
    if (call.body.stream !== true) return reply(response, id);
    if (call.auth === "Bearer sk-slow") {
      return void sse(response, chunks(id, ["one ", "two ", "three ", "four "], { prompt_tokens: 10, completion_tokens: 40 }), 400);
    }
    void sse(response, chunks(id, ["po", "ng"], { prompt_tokens: 10, completion_tokens: 5 }));
  });
  process.env.ANTHROPIC_BASE_URL = process.env.STUB_RAIL_URL;
  process.env.OPENAI_BASE_URL = process.env.STUB_RAIL_URL;
  process.env.COMMANDCODE_BASE_URL = process.env.STUB_RAIL_URL;
  process.env.ZEN_BASE_URL = process.env.STUB_RAIL_URL;
  process.env.OPENCODE_GO_BASE_URL = process.env.STUB_RAIL_URL;
  sellerId = await makeSeller();
});

after(async () => {
  if (!hasDb) return;
  rail?.close();
  await cleanup();
});

const chat = (key: string, body: Record<string, unknown>) => POST(jsonRequest(CHAT_URL, key, body));
const usageOf = (keyId: string) => db().select().from(usage).where(eq(usage.keyId, keyId));
const keyRow = async (id: string) => first(await db().select().from(keys).where(eq(keys.id, id)));
const listingRow = async (id: string) => first(await db().select().from(listings).where(eq(listings.id, id)));
const lastCall = () => {
  const call = rail?.calls.at(-1);
  if (!call) throw new Error("the stub saw no call");
  return call;
};

test("non-stream settles once and charges the mixed-token price", { skip }, async () => {
  const listingId = await makeListing({ sellerId, model: MODEL.basic, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.basic, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  assert.equal(payload.choices?.[0]?.message?.content, "pong");

  const forwarded = lastCall().body;
  assert.equal(forwarded.max_tokens, 16);
  assert.equal(forwarded.stream, false);
  assert.equal(forwarded.stream_options, undefined);
  assert.equal(forwarded.model, MODEL.basic);

  const row = first(await usageOf(key.id));
  assert.equal(row.status, "settled");
  assert.equal(row.promptTokens, 10);
  assert.equal(row.completionTokens, 5);
  assert.equal(row.mixedTokens, 9n);
  assert.equal(row.chargeUsdMicro, 14n);
  assert.equal(row.sellerEarningUsdMicro, 12n);
  assert.match(row.upstreamRequestId ?? "", /^stub:chatcmpl-/);

  const after = await keyRow(key.id);
  assert.equal(after.balanceUsdMicro, 1_000_000n - 14n);
  assert.equal(after.reservedUsdMicro, 0n);
  const listing = await listingRow(listingId);
  assert.equal(listing.usedTokens, 9n);
  assert.equal(listing.reservedTokens, 0n);
});

test("an unknown key is refused without writing a row", { skip }, async () => {
  const response = await chat("rk_unknown", { model: MODEL.basic, messages: ping });
  assert.equal(response.status, 401);
});

test("a balance that cannot cover the hold gets a plain 402", { skip }, async () => {
  const listingId = await makeListing({ sellerId, model: MODEL.poor, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1n);

  const response = await chat(key.raw, { model: MODEL.poor, messages: ping });
  assert.equal(response.status, 402);
  assert.equal(response.headers.get("payment-required"), null);
  const payload = (await response.json()) as { error?: { code?: string } };
  assert.equal(payload.error?.code, "insufficient_balance");
  assert.equal((await listingRow(listingId)).reservedTokens, 0n);
  assert.equal((await usageOf(key.id)).length, 0);
});

test("when every candidate fails the holds are released", { skip }, async () => {
  const listingId = await makeListing({ sellerId, model: MODEL.fail, credential: "sk-500", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.fail, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 502);
  assert.equal(first(await usageOf(key.id)).status, "released");
  const after = await keyRow(key.id);
  assert.equal(after.balanceUsdMicro, 1_000_000n);
  assert.equal(after.reservedUsdMicro, 0n);
  assert.equal((await listingRow(listingId)).reservedTokens, 0n);
});

test("a stream is forwarded and settled from the usage chunk", { skip }, async () => {
  const listingId = await makeListing({ sellerId, model: MODEL.stream, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.stream, messages: ping, max_tokens: 16, stream: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /"content":"po"/);
  assert.match(text, /"content":"ng"/);
  assert.match(text, /data: \[DONE\]/);

  const forwarded = lastCall().body;
  assert.equal(forwarded.stream, true);
  assert.deepEqual(forwarded.stream_options, { include_usage: true });
  assert.equal(forwarded.max_tokens, 16);

  const row = first(await usageOf(key.id));
  assert.equal(row.status, "settled");
  assert.equal(row.promptTokens, 10);
  assert.equal(row.completionTokens, 5);
  assert.equal(row.chargeUsdMicro, 14n);
  assert.equal((await keyRow(key.id)).balanceUsdMicro, 1_000_000n - 14n);
  assert.equal((await listingRow(listingId)).reservedTokens, 0n);
});

test("a client that walks away mid-stream is settled from what it received", { skip }, async () => {
  const listingId = await makeListing({ sellerId, model: MODEL.cancel, credential: "sk-slow", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.cancel, messages: ping, max_tokens: 64, stream: true });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  assert.equal((await reader.read()).done, false);
  await reader.cancel();

  const row = first(await usageOf(key.id));
  assert.equal(row.status, "settled");
  assert.equal(BigInt(row.promptTokens), estimatePromptTokens(new TextEncoder().encode(JSON.stringify(ping)).length));
  assert.ok(row.completionTokens >= 3 && row.completionTokens < 40);
  assert.ok(row.chargeUsdMicro > 0n && row.chargeUsdMicro <= row.reservedUsdMicro);
  const after = await keyRow(key.id);
  assert.equal(after.reservedUsdMicro, 0n);
  assert.equal(after.balanceUsdMicro, 1_000_000n - row.chargeUsdMicro);
  assert.equal((await listingRow(listingId)).reservedTokens, 0n);
});

test("a failing cheapest ask fails over to the next one", { skip }, async () => {
  const bad = await makeListing({ sellerId, model: MODEL.failover, credential: "sk-500", price: 1_000_000n, capacity: 1_000_000n });
  const good = await makeListing({ sellerId, model: MODEL.failover, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.failover, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const rows = await usageOf(key.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.listingId === bad)?.status, "released");
  assert.equal(rows.find((row) => row.listingId === good)?.status, "settled");
  assert.equal((await keyRow(key.id)).balanceUsdMicro, 1_000_000n - 14n);
  assert.equal((await listingRow(bad)).reservedTokens, 0n);
  assert.equal((await listingRow(bad)).status, "active");
});

test("cheapest: falls through to the next model when every seller of the cheapest fails", { skip }, async () => {
  const bad = await makeListing({ sellerId, model: MODEL.shortCheap, credential: "sk-500", price: 1_000_000n, capacity: 1_000_000n });
  const good = await makeListing({ sellerId, model: MODEL.shortNext, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: `cheapest:${MODEL.shortNext},${MODEL.shortCheap}`, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-router-model"), MODEL.shortNext);

  const rows = await usageOf(key.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.listingId === bad)?.status, "released");
  assert.equal(rows.find((row) => row.listingId === good)?.status, "settled");
  assert.equal((await keyRow(key.id)).balanceUsdMicro, 1_000_000n - 14n);
  assert.equal((await listingRow(bad)).reservedTokens, 0n);
});

test("the anthropic rail sends the seller key and Anthropic's dashed model id", { skip }, async () => {
  const listingId = await makeListing({
    sellerId,
    model: "claude-opus-5.5",
    rail: "anthropic",
    credential: "sk-anthropic",
    price: 3_000_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: "claude-opus-5.5", messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const forwarded = lastCall();
  assert.equal(forwarded.auth, "Bearer sk-anthropic");
  assert.equal(forwarded.body.model, "claude-opus-5-5");
  assert.equal(forwarded.session, "");
  assert.equal(forwarded.body.max_tokens, 16);
  assert.equal(forwarded.body.max_completion_tokens, undefined);

  const row = first(await usageOf(key.id));
  assert.equal(row.rail, "anthropic");
  assert.equal(row.status, "settled");
  assert.equal(row.chargeUsdMicro, 27n);
  assert.equal((await listingRow(listingId)).usedTokens, 9n);
});

test("the openai rail asks for max_completion_tokens", { skip }, async () => {
  await makeListing({
    sellerId,
    model: "gpt-6-sol",
    rail: "openai",
    credential: "sk-openai",
    price: 3_000_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: "gpt-6-sol", messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const forwarded = lastCall();
  assert.equal(forwarded.auth, "Bearer sk-openai");
  assert.equal(forwarded.body.max_completion_tokens, 16);
  assert.equal(forwarded.body.max_tokens, undefined);
});

test("a 401 from a rail invalidates only that listing", { skip }, async () => {
  const bad = await makeListing({
    sellerId,
    model: "claude-sonnet-5.5",
    rail: "anthropic",
    credential: "sk-401",
    price: 1_000_000n,
    capacity: 1_000_000n,
  });
  const good = await makeListing({
    sellerId,
    model: "claude-sonnet-5.5",
    rail: "anthropic",
    credential: "sk-ok",
    price: 1_500_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: "claude-sonnet-5.5", messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);
  assert.equal((await listingRow(bad)).status, "invalid");
  const rows = await usageOf(key.id);
  assert.equal(rows.find((row) => row.listingId === bad)?.status, "released");
  assert.equal(rows.find((row) => row.listingId === good)?.status, "settled");
});

test("the commandcode rail uses max_completion_tokens", { skip }, async () => {
  await makeListing({
    sellerId,
    model: "gpt-6.1-terra",
    rail: "commandcode",
    credential: "sk-cc",
    price: 2_000_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: "gpt-6.1-terra", messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const forwarded = lastCall();
  assert.equal(forwarded.auth, "Bearer sk-cc");
  assert.equal(forwarded.body.max_completion_tokens, 16);
  assert.equal(forwarded.body.max_tokens, undefined);
  assert.equal(first(await usageOf(key.id)).rail, "commandcode");
});

test("the zen rail dispatches its chat model with max_tokens", { skip }, async () => {
  await makeListing({
    sellerId,
    model: "glm-5.3",
    rail: "zen",
    credential: "sk-zen",
    price: 1_000_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: "glm-5.3", messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const forwarded = lastCall();
  assert.equal(forwarded.auth, "Bearer sk-zen");
  assert.equal(forwarded.body.model, "glm-5.3");
  assert.equal(forwarded.body.max_tokens, 16);
  assert.equal(first(await usageOf(key.id)).rail, "zen");
});

test("the opencode-go rail dispatches with max_tokens and a session header", { skip }, async () => {
  await makeListing({
    sellerId,
    model: "deepseek-v4.1-flash",
    rail: "opencode-go",
    credential: "sk-go",
    price: 1_000_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: "deepseek-v4.1-flash", messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const forwarded = lastCall();
  assert.equal(forwarded.auth, "Bearer sk-go");
  assert.match(forwarded.session, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(forwarded.body.max_tokens, 16);
  assert.equal(forwarded.body.max_completion_tokens, undefined);
  assert.equal(first(await usageOf(key.id)).rail, "opencode-go");
});

test("a policy 403 leaves the listing active", { skip }, async () => {
  const listingId = await makeListing({
    sellerId,
    model: MODEL.policy,
    credential: "sk-403-policy",
    price: 1_500_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.policy, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 400);
  assert.equal((await listingRow(listingId)).status, "active");
  assert.equal(first(await usageOf(key.id)).status, "released");
});

test("an upgrade 403 marks the listing invalid", { skip }, async () => {
  const listingId = await makeListing({
    sellerId,
    model: MODEL.upgrade,
    credential: "sk-403-upgrade",
    price: 1_500_000n,
    capacity: 1_000_000n,
  });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.upgrade, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 502);
  assert.equal((await listingRow(listingId)).status, "invalid");
  assert.equal(first(await usageOf(key.id)).status, "released");
});

test("a 429 throttles the listing and the next ask serves", { skip }, async () => {
  const limited = await makeListing({ sellerId, model: MODEL.throttle, credential: "sk-429", price: 1_000_000n, capacity: 1_000_000n });
  await makeListing({ sellerId, model: MODEL.throttle, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);

  const response = await chat(key.raw, { model: MODEL.throttle, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);
  const throttled = (await listingRow(limited)).throttledUntil;
  assert.ok(throttled && throttled.getTime() > Date.now() + 100_000);
});
