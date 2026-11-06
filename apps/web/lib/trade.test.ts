import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import { GET as book } from "../app/api/v1/book/route.ts";
import { POST as chat } from "../app/api/v1/chat/completions/route.ts";
import { POST as trade } from "../app/api/v1/trades/route.ts";
import { db } from "./db.ts";
import { releaseStale, reserve } from "./ledger.ts";
import { mixedTokens } from "./price.ts";
import { keys, listings, prepaid, trades, usage } from "./schema.ts";
import {
  cleanup,
  first,
  hasDb,
  jsonRequest,
  makeKey,
  makeListing,
  makeSeller,
  reply,
  skip,
  status,
  stubRail,
  suffix,
  type ChatCall,
  type StubUsage,
} from "./testkit.ts";
import type { Book, TradeResult } from "./types";

const MODEL = `t-${suffix}-trade`;
const SWEEP_MODEL = `t-${suffix}-sweep`;
const ping = [{ role: "user", content: "ping" }];

let rail: { calls: ChatCall[]; close: () => void } | null = null;
let sellerId = "";
let failNext = false;
let cheap = "";
let dear = "";
let buyer = { id: "", raw: "" };
let replyUsage: StubUsage = { prompt_tokens: 10, completion_tokens: 5 };

before(async () => {
  if (!hasDb) return;
  rail = await stubRail([MODEL, SWEEP_MODEL], (_call, response) => {
    if (failNext) {
      failNext = false;
      return status(response, 500);
    }
    reply(response, `chatcmpl-${suffix}-${rail?.calls.length ?? 0}`, replyUsage);
  });
  sellerId = await makeSeller();
  cheap = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_200_000n, capacity: 100_000n });
  dear = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  buyer = await makeKey(1_000_000n);
});

after(async () => {
  if (!hasDb) return;
  rail?.close();
  await cleanup();
});

const keyRow = async (id: string) => first(await db().select().from(keys).where(eq(keys.id, id)));
const listingRow = async (id: string) => first(await db().select().from(listings).where(eq(listings.id, id)));
const holdings = () => db().select().from(prepaid).where(eq(prepaid.keyId, buyer.id)).orderBy(asc(prepaid.createdAt));
const ask = (body: Record<string, unknown>) =>
  chat(jsonRequest("http://localhost/api/v1/chat/completions", buyer.raw, body));

test("a buy walks the asks cheapest first and books prepaid MTokens", { skip }, async () => {
  const response = await trade(jsonRequest("http://localhost/api/v1/trades", buyer.raw, { model: MODEL, tokens: "150000" }));
  assert.equal(response.status, 200);
  const result = (await response.json()) as TradeResult;
  assert.deepEqual(result.fills, [
    { listing_id: cheap, tokens: "100000", price_micro_per_mtok: "1200000", charge_usd_micro: "120000" },
    { listing_id: dear, tokens: "50000", price_micro_per_mtok: "1500000", charge_usd_micro: "75000" },
  ]);
  assert.equal(result.prepaid_tokens, "150000");

  assert.equal((await keyRow(buyer.id)).balanceUsdMicro, 1_000_000n - 195_000n);
  const cheapAfter = await listingRow(cheap);
  assert.equal(cheapAfter.usedTokens, 100_000n);
  assert.equal(cheapAfter.status, "exhausted");
  assert.equal((await listingRow(dear)).usedTokens, 50_000n);

  const fills = await db().select().from(trades).where(eq(trades.keyId, buyer.id)).orderBy(asc(trades.createdAt));
  assert.deepEqual(
    fills.map((row) => [row.listingId, row.tokens, row.sellerEarningUsdMicro]),
    [
      [cheap, 100_000n, 108_000n],
      [dear, 50_000n, 67_500n],
    ],
  );
  const held = await holdings();
  assert.deepEqual(
    held.map((row) => [row.listingId, row.tokensRemaining, row.expiresAt]),
    [
      [cheap, 100_000n, null],
      [dear, 50_000n, null],
    ],
  );
});

test("the book shows live asks and recent fills", { skip }, async () => {
  const response = await book(new Request(`http://localhost/api/v1/book?model=${MODEL}`));
  assert.equal(response.status, 200);
  const result = (await response.json()) as Book;
  assert.deepEqual(result.asks, [
    {
      listing_id: dear,
      offer_id: null,
      kind: "listing",
      rail: "stub",
      price_micro_per_mtok: "1500000",
      tokens_left: "950000",
      verifiable: false,
    },
  ]);
  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0]?.listing_id, dear);
});

test("a request spends prepaid MTokens first at zero charge", { skip }, async () => {
  const response = await ask({ model: MODEL, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const [cheapHold] = await holdings();
  const row = first(await db().select().from(usage).where(eq(usage.keyId, buyer.id)));
  assert.equal(row.status, "settled");
  assert.equal(row.prepaidId, cheapHold?.id);
  assert.equal(row.chargeUsdMicro, 0n);
  assert.equal(row.sellerEarningUsdMicro, 0n);
  assert.equal(cheapHold?.tokensRemaining, 100_000n - 9n);

  const key = await keyRow(buyer.id);
  assert.equal(key.balanceUsdMicro, 805_000n);
  assert.equal(key.reservedUsdMicro, 0n);
  const cheapAfter = await listingRow(cheap);
  assert.equal(cheapAfter.usedTokens, 100_000n);
  assert.equal(cheapAfter.reservedTokens, 0n);
});

test("a failed prepaid attempt hands the MTokens back and fails over", { skip }, async () => {
  failNext = true;
  const response = await ask({ model: MODEL, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const [cheapHold, dearHold] = await holdings();
  assert.equal(cheapHold?.tokensRemaining, 100_000n - 9n);
  assert.equal(dearHold?.tokensRemaining, 50_000n - 9n);
  const rows = await db().select().from(usage).where(eq(usage.keyId, buyer.id)).orderBy(asc(usage.createdAt));
  assert.deepEqual(
    rows.map((row) => [row.prepaidId, row.status]),
    [
      [cheapHold?.id, "settled"],
      [cheapHold?.id, "released"],
      [dearHold?.id, "settled"],
    ],
  );
  assert.equal((await keyRow(buyer.id)).balanceUsdMicro, 805_000n);
});

test("a cancelled listing still serves the prepaid MTokens it already sold", { skip }, async () => {
  await db().update(listings).set({ status: "cancelled" }).where(eq(listings.id, cheap));
  const response = await ask({ model: MODEL, messages: ping, max_tokens: 16 });
  assert.equal(response.status, 200);

  const [cheapHold] = await holdings();
  assert.equal(cheapHold?.tokensRemaining, 100_000n - 18n);
  const last = (await db().select().from(usage).where(eq(usage.keyId, buyer.id)).orderBy(asc(usage.createdAt))).at(-1);
  assert.deepEqual([last?.prepaidId, last?.status, last?.chargeUsdMicro], [cheapHold?.id, "settled", 0n]);
});

test("a prepaid request that runs past its reservation is deducted its actual MTokens", { skip }, async () => {
  const [before] = await holdings();
  replyUsage = { prompt_tokens: 400, completion_tokens: 100 };
  const response = await ask({ model: MODEL, messages: ping, max_tokens: 16 });
  replyUsage = { prompt_tokens: 10, completion_tokens: 5 };
  assert.equal(response.status, 200);

  const [after] = await holdings();
  const last = (await db().select().from(usage).where(eq(usage.keyId, buyer.id)).orderBy(asc(usage.createdAt))).at(-1);
  assert.ok((last?.reservedTokens ?? 0n) < mixedTokens(400n, 100n));
  assert.equal(last?.mixedTokens, mixedTokens(400n, 100n));
  assert.equal((before?.tokensRemaining ?? 0n) - (after?.tokensRemaining ?? 0n), mixedTokens(400n, 100n));
});

test("the sweep releases holds a dead function left open", { skip }, async () => {
  const listingId = await makeListing({ sellerId, model: SWEEP_MODEL, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
  const key = await makeKey(1_000_000n);
  const held = await reserve({ keyId: key.id, listingId, rail: "stub", price: 1_500_000n, tokens: 1_000n, micro: 1_500n });
  assert.ok(held.usageId);
  await db().update(usage).set({ createdAt: new Date(Date.now() - 600_000) }).where(eq(usage.id, held.usageId));
  assert.equal((await keyRow(key.id)).reservedUsdMicro, 1_500n);

  assert.ok((await releaseStale()) >= 1);
  assert.equal(first(await db().select().from(usage).where(eq(usage.id, held.usageId))).status, "released");
  const after = await keyRow(key.id);
  assert.equal(after.balanceUsdMicro, 1_000_000n);
  assert.equal(after.reservedUsdMicro, 0n);
  assert.equal((await listingRow(listingId)).reservedTokens, 0n);
});
