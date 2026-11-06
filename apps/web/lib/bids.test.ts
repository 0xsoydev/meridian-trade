import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { DELETE as cancel } from "../app/api/v1/bids/[id]/route.ts";
import { GET as openBids } from "../app/api/v1/bids/route.ts";
import { GET as book } from "../app/api/v1/book/route.ts";
import { POST as trade } from "../app/api/v1/trades/route.ts";
import { matchBids } from "./bids.ts";
import { db } from "./db.ts";
import { sellerEarning } from "./price.ts";
import { bids, keys, listings, prepaid, trades } from "./schema.ts";
import { cleanup, first, hasDb, jsonRequest, makeKey, makeListing, makeSeller, reply, skip, stubRail, suffix, type ChatCall } from "./testkit.ts";
import type { Bid, Book, TradeResult } from "./types";

const MODEL = `t-${suffix}-bids`;

let rail: { calls: ChatCall[]; close: () => void } | null = null;
let sellerId = "";
let cheap = "";
let buyer = { id: "", raw: "" };
let bidId = "";

before(async () => {
  if (!hasDb) return;
  rail = await stubRail([MODEL], (_call, response) => reply(response, `chatcmpl-${suffix}-bids`));
  sellerId = await makeSeller();
  cheap = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_000_000n, capacity: 100_000n });
  await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 2_000_000n, capacity: 1_000_000n });
  buyer = await makeKey(1_000_000n);
});

after(async () => {
  if (!hasDb) return;
  rail?.close();
  await cleanup();
});

const balance = async () => first(await db().select().from(keys).where(eq(keys.id, buyer.id))).balanceUsdMicro;
const bidRow = async () => first(await db().select().from(bids).where(eq(bids.id, bidId)));

test("a limit buy fills asks at or below its price and rests the rest, holding exactly its cost", { skip }, async () => {
  const response = await trade(
    jsonRequest("http://localhost/api/v1/trades", buyer.raw, { model: MODEL, tokens: "300000", limit_price_micro_per_mtok: "1500000" }),
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as TradeResult;
  assert.deepEqual(result.fills, [{ listing_id: cheap, tokens: "100000", price_micro_per_mtok: "1000000", charge_usd_micro: "100000" }]);
  assert.equal(result.bid?.tokens, "200000");
  assert.equal(result.bid?.hold_usd_micro, "300000");
  bidId = result.bid?.bid_id ?? "";

  assert.equal(await balance(), 1_000_000n - 100_000n - 300_000n);
  const levels = ((await (await book(new Request(`http://localhost/api/v1/book?model=${MODEL}`))).json()) as Book).bids;
  assert.deepEqual(levels, [{ price_micro_per_mtok: "1500000", tokens: "200000" }]);
});

test("a limit above the model's list price is refused before anything fills", { skip }, async () => {
  const response = await trade(
    jsonRequest("http://localhost/api/v1/trades", buyer.raw, { model: MODEL, tokens: "1000", limit_price_micro_per_mtok: "2150001" }),
  );
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: { message: string } }).error.message, /list price/);
  assert.equal(await balance(), 600_000n);
});

test("a new ask at or below the best bid fills it at the bid's price, out of the hold", { skip }, async () => {
  const under = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 1_200_000n, capacity: 150_000n });
  assert.equal(await matchBids(MODEL), 1);

  const printed = first(await db().select().from(trades).where(eq(trades.listingId, under)));
  assert.equal(printed.keyId, buyer.id);
  assert.equal(printed.tokens, 150_000n);
  assert.equal(printed.priceMicroPerMtok, 1_500_000n);
  assert.equal(printed.chargeUsdMicro, 225_000n);
  assert.equal(printed.sellerEarningUsdMicro, sellerEarning(225_000n, BigInt(process.env.TAKE_BPS ?? "1000")));

  const rest = await bidRow();
  assert.deepEqual([rest.status, rest.tokens, rest.holdUsdMicro], ["open", 50_000n, 75_000n]);
  assert.equal(first(await db().select().from(listings).where(eq(listings.id, under))).status, "exhausted");
  const held = first(await db().select().from(prepaid).where(and(eq(prepaid.keyId, buyer.id), eq(prepaid.listingId, under))));
  assert.equal(held.tokensRemaining, 150_000n);
  assert.equal(await balance(), 600_000n);
});

test("cancel returns what is still held, exactly once", { skip }, async () => {
  const call = () =>
    cancel(jsonRequest(`http://localhost/api/v1/bids/${bidId}`, buyer.raw, {}, "DELETE"), { params: Promise.resolve({ id: bidId }) });
  const cancelled = await call();
  assert.equal(cancelled.status, 200);
  assert.equal(((await cancelled.json()) as { balance_usd_micro: string }).balance_usd_micro, "675000");
  assert.equal((await call()).status, 404);

  const rest = await bidRow();
  assert.deepEqual([rest.status, rest.holdUsdMicro], ["cancelled", 0n]);
  assert.equal(await balance(), 1_000_000n - 100_000n - 225_000n);
  const listed = await openBids(
    new Request(`http://localhost/api/v1/bids?model=${MODEL}`, { headers: { authorization: `Bearer ${buyer.raw}` } }),
  );
  assert.deepEqual(((await listed.json()) as { data: Bid[] }).data, []);
});
