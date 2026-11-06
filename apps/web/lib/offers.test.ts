import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { GET as book } from "../app/api/v1/book/route.ts";
import { GET as holdingsRoute } from "../app/api/v1/holdings/route.ts";
import { DELETE as cancel } from "../app/api/v1/offers/[id]/route.ts";
import { POST as sell } from "../app/api/v1/sells/route.ts";
import { POST as trade } from "../app/api/v1/trades/route.ts";
import { db } from "./db.ts";
import { closeDay } from "./payouts.ts";
import { sellerEarning } from "./price.ts";
import { bids, keys, offers, payouts, prepaid, trades } from "./schema.ts";
import { cleanup, first, hasDb, jsonRequest, makeKey, makeListing, makeSeller, reply, skip, stubRail, suffix, type ChatCall } from "./testkit.ts";
import type { Book, Holding, SellResult, TradeResult } from "./types";

const MODEL = `t-${suffix}-resale`;
const EXPIRES = new Date(Date.now() + 86_400_000);

let rail: { calls: ChatCall[]; close: () => void } | null = null;
let sellerId = "";
let listingId = "";
let reseller = { id: "", raw: "" };
let bidder = { id: "", raw: "" };
let buyer = { id: "", raw: "" };
let offerId = "";

before(async () => {
  if (!hasDb) return;
  rail = await stubRail([MODEL], (_call, response) => reply(response, `chatcmpl-${suffix}-resale`));
  sellerId = await makeSeller();
  listingId = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 2_000_000n, capacity: 10_000_000n });
  reseller = await makeKey(5_000_000n);
  bidder = await makeKey(1_000_000n);
  buyer = await makeKey(3_000_000n);
  const bought = await trade(jsonRequest("http://localhost/api/v1/trades", reseller.raw, { model: MODEL, tokens: "2000000" }));
  assert.equal(bought.status, 200);
  await db().update(prepaid).set({ expiresAt: EXPIRES }).where(eq(prepaid.keyId, reseller.id));
  const bid = (await (
    await trade(jsonRequest("http://localhost/api/v1/trades", bidder.raw, { model: MODEL, tokens: "500000", limit_price_micro_per_mtok: "1500000" }))
  ).json()) as TradeResult;
  assert.equal(bid.bid?.hold_usd_micro, "750000");
});

after(async () => {
  if (!hasDb) return;
  rail?.close();
  const mine = [reseller.id, bidder.id, buyer.id];
  await db().delete(offers).where(inArray(offers.keyId, mine));
  await db().delete(trades).where(or(inArray(trades.keyId, mine), inArray(trades.sellerKeyId, mine)));
  await db().delete(payouts).where(eq(payouts.sellerId, sellerId));
  await cleanup();
});

const balanceOf = async (id: string) => first(await db().select().from(keys).where(eq(keys.id, id))).balanceUsdMicro;
const prepaidOf = async (id: string) => db().select().from(prepaid).where(and(eq(prepaid.keyId, id), eq(prepaid.model, MODEL)));
const held = async (id: string) => (await prepaidOf(id)).reduce((sum, row) => sum + row.tokensRemaining, 0n);
const sellRequest = (body: Record<string, string>) => sell(jsonRequest("http://localhost/api/v1/sells", reseller.raw, { model: MODEL, ...body }));

test("a market sell fills the best bid at its price and hands over MTokens on the same listing and expiry", { skip }, async () => {
  const before = await balanceOf(reseller.id);
  const response = await sellRequest({ tokens: "400000" });
  assert.equal(response.status, 200);
  const result = (await response.json()) as SellResult;
  assert.deepEqual(result.fills, [{ listing_id: listingId, tokens: "400000", price_micro_per_mtok: "1500000", charge_usd_micro: "600000" }]);
  assert.deepEqual(result.offers, []);
  assert.equal(result.holding_tokens, "1600000");

  assert.equal(await balanceOf(reseller.id), before + sellerEarning(600_000n, 1000n));
  const bid = first(await db().select().from(bids).where(eq(bids.keyId, bidder.id)));
  assert.deepEqual([bid.tokens, bid.holdUsdMicro, bid.status], [100_000n, 150_000n, "open"]);
  const [received] = await prepaidOf(bidder.id);
  assert.deepEqual([received?.listingId, received?.tokensRemaining, received?.expiresAt?.getTime()], [listingId, 400_000n, EXPIRES.getTime()]);
  const resold = first(await db().select().from(trades).where(eq(trades.sellerKeyId, reseller.id)));
  assert.deepEqual([resold.keyId, resold.chargeUsdMicro, resold.sellerEarningUsdMicro], [bidder.id, 600_000n, 540_000n]);
});

test("a limit sell above the best bid escrows an offer that inference cannot spend, and a buy takes it before a pricier listing", { skip }, async () => {
  const response = await sellRequest({ tokens: "1000000", limit_price_micro_per_mtok: "1800000" });
  assert.equal(response.status, 200);
  const result = (await response.json()) as SellResult;
  assert.deepEqual(result.fills, []);
  assert.equal(result.offers.length, 1);
  assert.deepEqual([result.offers[0]?.tokens, result.offers[0]?.price_micro_per_mtok, result.offers[0]?.expires_at], [
    "1000000",
    "1800000",
    EXPIRES.toISOString(),
  ]);
  offerId = result.offers[0]?.offer_id ?? "";
  assert.equal(await held(reseller.id), 600_000n);
  const holdingsRequest = new Request(`http://localhost/api/v1/holdings?model=${MODEL}`, {
    headers: { authorization: `Bearer ${reseller.raw}` },
  });
  const holdings = (await (await holdingsRoute(holdingsRequest)).json()) as { data: Holding[] };
  assert.deepEqual(holdings.data.map((row) => row.tokens), ["600000"]);

  const levels = ((await (await book(new Request(`http://localhost/api/v1/book?model=${MODEL}`))).json()) as Book).asks;
  assert.deepEqual(levels.map((ask) => [ask.kind, ask.price_micro_per_mtok]), [["resale", "1800000"], ["listing", "2000000"]]);

  const own = (await (
    await trade(jsonRequest("http://localhost/api/v1/trades", reseller.raw, { model: MODEL, tokens: "100000", limit_price_micro_per_mtok: "1800000" }))
  ).json()) as TradeResult;
  assert.deepEqual(own.fills, []);

  const sellerBefore = await balanceOf(reseller.id);
  const bought = (await (await trade(jsonRequest("http://localhost/api/v1/trades", buyer.raw, { model: MODEL, tokens: "500000" }))).json()) as TradeResult;
  assert.deepEqual(bought.fills, [{ listing_id: listingId, tokens: "500000", price_micro_per_mtok: "1800000", charge_usd_micro: "900000" }]);
  assert.equal(await balanceOf(buyer.id), 3_000_000n - 900_000n);
  assert.equal(await balanceOf(reseller.id), sellerBefore + sellerEarning(900_000n, 1000n));
  const [received] = await prepaidOf(buyer.id);
  assert.deepEqual([received?.tokensRemaining, received?.expiresAt?.getTime()], [500_000n, EXPIRES.getTime()]);
  assert.equal(first(await db().select().from(offers).where(eq(offers.id, offerId))).tokens, 500_000n);
});

test("cancelling an offer returns its MTokens, and the nightly close keeps resale out of provider payouts", { skip }, async () => {
  const response = await cancel(jsonRequest(`http://localhost/api/v1/offers/${offerId}`, reseller.raw, null, "DELETE"), {
    params: Promise.resolve({ id: offerId }),
  });
  assert.equal(response.status, 200);
  assert.equal(await held(reseller.id), 1_100_000n);
  const again = await cancel(jsonRequest(`http://localhost/api/v1/offers/${offerId}`, reseller.raw, null, "DELETE"), {
    params: Promise.resolve({ id: offerId }),
  });
  assert.equal(again.status, 404);

  const day = "2001-02-01";
  await db()
    .update(trades)
    .set({ createdAt: new Date(`${day}T12:00:00Z`) })
    .where(or(eq(trades.keyId, reseller.id), eq(trades.sellerKeyId, reseller.id)));
  assert.equal(await closeDay(day), 1);
  const payout = first(await db().select().from(payouts).where(eq(payouts.sellerId, sellerId)));
  assert.equal(payout.amountUsdMicro, sellerEarning(4_000_000n, 1000n));
});

test("a sell above list price, past the holding, or into no bids is refused", { skip }, async () => {
  assert.equal((await sellRequest({ tokens: "1000", limit_price_micro_per_mtok: "2150001" })).status, 400);
  assert.equal((await sellRequest({ tokens: "99000000" })).status, 400);
  await db().update(bids).set({ status: "cancelled" }).where(eq(bids.keyId, bidder.id));
  assert.equal((await sellRequest({ tokens: "1000" })).status, 404);
});
