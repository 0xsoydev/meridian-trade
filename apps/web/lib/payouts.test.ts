import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import {
  checkScheduled,
  closeDay,
  mirrorAccount,
  payAt,
  resetDailyListings,
  scheduleExpiry,
  scheduleSlot,
  scheduleState,
  utcDay,
} from "./payouts.ts";
import { listings, payouts, trades, usage } from "./schema.ts";
import { cleanup, first, hasDb, makeKey, makeListing, makeSeller, reply, skip, stubRail, suffix, type ChatCall } from "./testkit.ts";

const MODEL = `t-${suffix}-payout`;
const DAY = "2001-01-01";
let rail: { calls: ChatCall[]; close: () => void } | null = null;
let sellerId = "";
let listingId = "";
let keyId = "";

before(async () => {
  if (!hasDb) return;
  rail = await stubRail([MODEL], (_call, response) => reply(response, `chatcmpl-${suffix}-payout`));
  sellerId = await makeSeller();
  listingId = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_000_000n, capacity: 10_000_000n });
  keyId = (await makeKey(0n)).id;
});

after(async () => {
  if (!hasDb) return;
  await db().delete(usage).where(eq(usage.keyId, keyId));
  await db().delete(trades).where(eq(trades.keyId, keyId));
  await db().delete(payouts).where(eq(payouts.sellerId, sellerId));
  rail?.close();
  await cleanup();
});

test("utcDay and payAt pin the payout to 01:00 UTC the next day", () => {
  assert.equal(utcDay(Date.parse("2026-11-06T23:59:59.999Z")), "2026-11-06");
  assert.equal(payAt("2026-11-06").toISOString(), "2026-11-07T01:00:00.000Z");
  assert.equal(payAt("2026-12-31").toISOString(), "2027-01-01T01:00:00.000Z");
});

test("a payout scheduled after its 01:00 UTC slot executes ten minutes out instead of getting stuck", () => {
  assert.equal(scheduleExpiry("2026-11-06", Date.parse("2026-11-07T00:30:00Z")).toISOString(), "2026-11-07T01:00:00.000Z");
  assert.equal(scheduleExpiry("2026-11-03", Date.parse("2026-11-04T15:00:00Z")).toISOString(), "2026-11-04T15:10:00.000Z");
});

test("a late payout keeps the slot its first attempt claimed, so a retry rebuilds the identical schedule", { skip }, async () => {
  const day = "2001-04-01";
  const { id } = first(await db().insert(payouts).values({ sellerId, day, amountUsdMicro: 1n, status: "pending" }).returning({ id: payouts.id }));
  const firstTry = Date.parse("2026-11-04T15:00:00Z");
  assert.equal((await scheduleSlot(id, day, firstTry))?.toISOString(), "2026-11-04T15:10:00.000Z");
  assert.equal((await scheduleSlot(id, day, firstTry + 60_000))?.toISOString(), "2026-11-04T15:10:00.000Z");
  await db().update(payouts).set({ status: "scheduled" }).where(eq(payouts.id, id));
  assert.equal(await scheduleSlot(id, day, firstTry), null);
  await db().delete(payouts).where(eq(payouts.id, id));
});

test("the daily reset frees a daily-rail listing once per UTC day, whenever the keeper runs", { skip }, async () => {
  const daily = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_000_000n, capacity: 10_000_000n, rail: "0g" });
  const row = async () => first(await db().select().from(listings).where(eq(listings.id, daily)));
  const today = utcDay(Date.now());
  assert.equal((await row()).resetOn, today);

  await db().update(listings).set({ usedTokens: 10_000_000n, status: "exhausted", resetOn: "2001-01-01" }).where(eq(listings.id, daily));
  assert.ok((await resetDailyListings(today)) >= 1);
  const freed = await row();
  assert.deepEqual([freed.usedTokens, freed.status, freed.resetOn], [0n, "active", today]);

  await db().update(listings).set({ usedTokens: 3_000_000n }).where(eq(listings.id, daily));
  await resetDailyListings(today);
  assert.equal((await row()).usedTokens, 3_000_000n);
});

test("mirror lookups map accounts and schedule states, and a failed transfer is not executed", async () => {
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    const send = (code: number, body: unknown) => {
      response.writeHead(code, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.endsWith("/accounts/0xknown")) return send(200, { account: "0.0.4242" });
    if (url.endsWith("/accounts/0xnew")) return send(404, {});
    if (url.endsWith("/schedules/0.0.1")) return send(200, { executed_timestamp: "1.0", deleted: false });
    if (url.endsWith("/schedules/0.0.2")) return send(200, { executed_timestamp: null, deleted: true });
    if (url.endsWith("/schedules/0.0.3")) return send(200, { executed_timestamp: null, deleted: false });
    if (url.endsWith("/schedules/0.0.4")) return send(200, { executed_timestamp: "4.0", deleted: false });
    if (url.endsWith("timestamp=1.0")) return send(200, { transactions: [{ result: "SUCCESS", scheduled: true }] });
    if (url.endsWith("timestamp=4.0")) return send(200, { transactions: [{ result: "INSUFFICIENT_TOKEN_BALANCE", scheduled: true }] });
    send(500, {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  process.env.MIRROR_NODE_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    assert.equal(await mirrorAccount("0xknown"), "0.0.4242");
    assert.equal(await mirrorAccount("0xnew"), null);
    await assert.rejects(mirrorAccount("0xbroken"));
    assert.equal(await scheduleState("0.0.1"), "executed");
    assert.equal(await scheduleState("0.0.2"), "cancelled");
    assert.equal(await scheduleState("0.0.3"), "waiting");
    assert.equal(await scheduleState("0.0.4"), "failed");
  } finally {
    server.close();
  }
});

test("closeDay sums a seller's unpaid earnings once and links exactly those rows", { skip }, async () => {
  const at = (iso: string) => new Date(iso);
  const trade = (earning: bigint, created: string) => ({
    keyId,
    listingId,
    model: MODEL,
    tokens: 1_000n,
    priceMicroPerMtok: 1_000_000n,
    chargeUsdMicro: earning,
    sellerEarningUsdMicro: earning,
    createdAt: at(created),
  });
  const paidUsage = (earning: bigint, settled: string) => ({
    status: "settled",
    rail: "stub",
    keyId,
    listingId,
    priceMicroPerMtok: 1_000_000n,
    chargeUsdMicro: earning,
    sellerEarningUsdMicro: earning,
    settledAt: at(settled),
  });
  const inside = await db()
    .insert(trades)
    .values([trade(900n, `${DAY}T10:00:00Z`), trade(100n, `${DAY}T23:59:59Z`)])
    .returning({ id: trades.id });
  const late = first(await db().insert(trades).values(trade(7n, "2001-01-02T00:00:00Z")).returning({ id: trades.id }));
  const used = first(await db().insert(usage).values(paidUsage(500n, `${DAY}T12:00:00Z`)).returning({ id: usage.id }));
  const prepaid = first(await db().insert(usage).values(paidUsage(0n, `${DAY}T12:00:00Z`)).returning({ id: usage.id }));

  assert.equal(await closeDay(DAY), 1);
  const payout = first(await db().select().from(payouts).where(eq(payouts.sellerId, sellerId)));
  assert.deepEqual([payout.day, payout.amountUsdMicro, payout.status], [DAY, 1_500n, "pending"]);

  const linkedTrades = await db().select({ id: trades.id, payoutId: trades.payoutId }).from(trades).where(inArray(trades.id, [...inside.map((r) => r.id), late.id]));
  const linkedUsage = await db().select({ id: usage.id, payoutId: usage.payoutId }).from(usage).where(inArray(usage.id, [used.id, prepaid.id]));
  const linked = [...linkedTrades, ...linkedUsage].filter((r) => r.payoutId === payout.id).map((r) => r.id).sort();
  assert.deepEqual(linked, [...inside.map((r) => r.id), used.id].sort());

  assert.equal(await closeDay(DAY), 0);
  const again = await db().select().from(payouts).where(eq(payouts.sellerId, sellerId));
  assert.deepEqual(again.map((p) => p.amountUsdMicro), [1_500n]);
});

test("one mirror error does not stop checkScheduled from settling the other schedules", { skip }, async () => {
  const [broken, fine] = await db()
    .insert(payouts)
    .values([
      { sellerId, day: "2001-03-01", amountUsdMicro: 1n, scheduleId: "0.0.900001", status: "scheduled" },
      { sellerId, day: "2001-03-02", amountUsdMicro: 1n, scheduleId: "0.0.900002", status: "scheduled" },
    ])
    .returning({ id: payouts.id });
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    const send = (code: number, body: unknown) => {
      response.writeHead(code, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url.endsWith("/schedules/0.0.900002")) return send(200, { executed_timestamp: "9.0", deleted: false });
    if (url.endsWith("timestamp=9.0")) return send(200, { transactions: [{ result: "SUCCESS", scheduled: true }] });
    send(503, {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  process.env.MIRROR_NODE_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const lines = await checkScheduled();
    assert.ok(lines.some((l) => l.startsWith(`[payout] ${broken?.id}: mirror returned 503`)));
    assert.ok(lines.includes(`[payout] ${fine?.id}: schedule 0.0.900002 executed`));
    const rows = await db().select({ id: payouts.id, status: payouts.status }).from(payouts).where(inArray(payouts.id, [broken?.id ?? "", fine?.id ?? ""]));
    assert.deepEqual(new Map(rows.map((r) => [r.id, r.status])), new Map([[broken?.id, "scheduled"], [fine?.id, "executed"]]));
  } finally {
    server.close();
  }
});
