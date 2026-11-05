import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db.ts";
import { buildRollups, markPublished, minuteFills } from "./hcs.ts";
import { trades, usage } from "./schema.ts";
import { cleanup, first, hasDb, makeKey, makeListing, makeSeller, skip, suffix } from "./testkit.ts";

const MODEL = `t-${suffix}-hcs`;
const MINUTE = Date.parse("2002-01-01T10:00:00Z") / 60_000;
const inMinute = new Date(MINUTE * 60_000 + 30_000);
const nextMinute = new Date((MINUTE + 1) * 60_000);
let listingId = "";
let keyId = "";

before(async () => {
  if (!hasDb) return;
  const sellerId = await makeSeller();
  listingId = await makeListing({ sellerId, model: MODEL, credential: "sk-ok", price: 2_000_000n, capacity: 10_000_000n });
  keyId = (await makeKey(0n)).id;
});

after(async () => {
  if (!hasDb) return;
  await db().delete(usage).where(eq(usage.keyId, keyId));
  await db().delete(trades).where(eq(trades.keyId, keyId));
  await cleanup();
});

test("minuteFills reads one minute of trades and paid usage, and markPublished stamps only that usage", { skip }, async () => {
  const usageRow = (status: string, charge: bigint, mixed: bigint, settledAt: Date) => ({
    status,
    rail: "stub",
    keyId,
    listingId,
    priceMicroPerMtok: 2_000_000n,
    mixedTokens: mixed,
    chargeUsdMicro: charge,
    settledAt,
  });
  const trade = first(
    await db()
      .insert(trades)
      .values({ keyId, listingId, model: MODEL, tokens: 500_000n, priceMicroPerMtok: 2_000_000n, chargeUsdMicro: 1_000_000n, sellerEarningUsdMicro: 900_000n, createdAt: inMinute })
      .returning({ id: trades.id }),
  );
  const rows = await db()
    .insert(usage)
    .values([
      usageRow("settled", 2_000_000n, 1_000_000n, inMinute),
      usageRow("settled", 0n, 1_000_000n, inMinute),
      usageRow("open", 2_000_000n, 1_000_000n, inMinute),
      usageRow("settled", 2_000_000n, 1_000_000n, nextMinute),
    ])
    .returning({ id: usage.id });
  const [paid, prepaid, open, late] = rows.map((r) => r.id);

  const fills = (await minuteFills(MINUTE)).filter((f) => f.model === MODEL);
  assert.deepEqual(fills.map((f) => f.id).sort(), [paid, trade.id].sort());
  const [rollup] = buildRollups(MINUTE, fills);
  assert.deepEqual([rollup?.fills, rollup?.charge_usd_micro, rollup?.mixed_tokens, rollup?.vwap_micro_per_mtok], [2, "3000000", "1500000", "2000000"]);

  await markPublished(MINUTE, fills);
  const stamped = await db().select({ id: usage.id, minute: usage.hcsMinute }).from(usage).where(inArray(usage.id, rows.map((r) => r.id)));
  assert.deepEqual(
    stamped.filter((r) => r.minute === BigInt(MINUTE)).map((r) => r.id),
    [paid],
  );
  assert.ok(prepaid && open && late);
});
