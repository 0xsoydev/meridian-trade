import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { closeDay, mirrorAccount, payAt, scheduleState, utcDay } from "./payouts.ts";
import { payouts, trades, usage } from "./schema.ts";
import { cleanup, first, hasDb, makeKey, makeListing, makeSeller, skip, suffix } from "./testkit.ts";

const MODEL = `t-${suffix}-payout`;
const DAY = "2001-01-01";
let sellerId = "";
let listingId = "";
let keyId = "";

before(async () => {
  if (!hasDb) return;
  sellerId = await makeSeller();
  listingId = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_000_000n, capacity: 10_000_000n });
  keyId = (await makeKey(0n)).id;
});

after(async () => {
  if (!hasDb) return;
  await db().delete(usage).where(eq(usage.keyId, keyId));
  await db().delete(trades).where(eq(trades.keyId, keyId));
  await db().delete(payouts).where(eq(payouts.sellerId, sellerId));
  await cleanup();
});

test("utcDay and payAt pin the payout to 01:00 UTC the next day", () => {
  assert.equal(utcDay(Date.parse("2026-11-06T23:59:59.999Z")), "2026-11-06");
  assert.equal(payAt("2026-11-06").toISOString(), "2026-11-07T01:00:00.000Z");
  assert.equal(payAt("2026-12-31").toISOString(), "2027-01-01T01:00:00.000Z");
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
