import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "./db.ts";
import { perpFills, perpHistory, recordPerpEvents, recordedPerps, type PerpEventRow } from "./perp-events.ts";
import { perpEvents } from "./schema.ts";
import { skip } from "./testkit.ts";

const account = `0x${randomBytes(20).toString("hex")}`;
const at = new Date("2026-11-05T00:00:00Z");
const row = (block: bigint, kind: string, size: bigint, margin: bigint, extra: Partial<PerpEventRow> = {}): PerpEventRow => ({
  txHash: `0x${randomBytes(32).toString("hex")}`,
  logIndex: 0,
  account,
  model: "glm-5.3",
  kind,
  size,
  margin,
  price: 150_000n,
  realizedPnl: 0n,
  fee: 0n,
  reward: 0n,
  block,
  at,
  ...extra,
});

const tape = [
  row(1n, "modify", 5_000_000n, 200_000n, { fee: 750n }),
  row(2n, "modify", 8_000_000n, 300_000n),
  row(3n, "modify", 3_000_000n, 340_000n, { realizedPnl: 40_000n }),
  row(3n, "modify", 3_000_000n, 400_000n, { logIndex: 1 }),
  row(4n, "liquidate", 0n, 0n, { reward: 2_000n, price: 120_000n }),
  row(5n, "modify", -2_000_000n, 90_000n),
];

test("fills turn new sizes into size changes, and a liquidation loses the margin it held", () => {
  const fills = perpFills(tape).map((fill) => [fill.kind, fill.size_change, fill.size_after, fill.realized_pnl_usd_micro]);
  assert.deepEqual(fills, [
    ["modify", "5000000", "5000000", "0"],
    ["modify", "3000000", "8000000", "0"],
    ["modify", "-5000000", "3000000", "40000"],
    ["modify", "0", "3000000", "0"],
    ["liquidate", "-3000000", "0", "-400000"],
    ["modify", "-2000000", "-2000000", "0"],
  ]);
});

test("recording the same events twice keeps one row each, and history is newest-first fills only", { skip }, async () => {
  await recordPerpEvents(tape);
  await recordPerpEvents(tape);
  const history = await perpHistory(account.toUpperCase().replace("0X", "0x"));
  assert.deepEqual(
    history.map((fill) => fill.size_change),
    ["-2000000", "-3000000", "-5000000", "3000000", "5000000"],
  );
  assert.equal(history[1]?.reward_usd_micro, "2000");
  const recorded = await recordedPerps();
  assert.ok(recorded.positions.some((position) => position.account === account && position.model === "glm-5.3"));
  assert.ok((recorded.lastBlock ?? 0n) >= 5n);
  await db().delete(perpEvents).where(eq(perpEvents.account, account));
});
