import assert from "node:assert/strict";
import test from "node:test";
import { liquidatable, liquidationPrice, marketId, notional, openMargin, orderPlan, positionAfter, tradeFee } from "./perp.ts";

test("the position an order leaves matches what PerpMarket books", () => {
  const price = 150_000n;
  const fee = (size: bigint) => tradeFee(size, price);
  const held = { size: 10_000_000n, margin: 400_000n, entryPrice: 100_000n, fundingOwed: 1_000n };
  const open = openMargin(5_000_000n, price, 5n);
  assert.deepEqual(positionAfter(null, [{ sizeDelta: 5_000_000n, margin: open }], price), {
    size: 5_000_000n,
    margin: open - fee(5_000_000n),
    entryPrice: price,
    fundingOwed: 0n,
  });
  assert.deepEqual(positionAfter(held, [{ sizeDelta: 5_000_000n, margin: open }], price), {
    size: 15_000_000n,
    margin: 400_000n - 1_000n - fee(5_000_000n) + open,
    entryPrice: (10_000_000n * 100_000n + 5_000_000n * price) / 15_000_000n,
    fundingOwed: 0n,
  });
  assert.deepEqual(positionAfter(held, [{ sizeDelta: -4_000_000n, margin: 0n }], price), {
    size: 6_000_000n,
    margin: 400_000n - 1_000n - fee(4_000_000n) + 200_000n,
    entryPrice: 100_000n,
    fundingOwed: 0n,
  });
  const rest = openMargin(-4_000_000n, price, 5n);
  assert.deepEqual(
    positionAfter(held, [{ sizeDelta: -10_000_000n, margin: 0n }, { sizeDelta: -4_000_000n, margin: rest }], price),
    { size: -4_000_000n, margin: rest - fee(4_000_000n), entryPrice: price, fundingOwed: 0n },
  );
  assert.equal(positionAfter(held, [{ sizeDelta: -10_000_000n, margin: 0n }], price), null);
});

test("an order opens, adds, reduces and closes in one leg, and flips as close then open", () => {
  const price = 150_000n;
  const legs = (current: bigint, delta: bigint) =>
    orderPlan(current, delta, price, 5n).map((leg) => [leg.sizeDelta, leg.margin]);
  assert.deepEqual(legs(0n, -3n), [[-3n, openMargin(-3n, price, 5n)]]);
  assert.deepEqual(legs(10n, 5n), [[5n, openMargin(5n, price, 5n)]]);
  assert.deepEqual(legs(10n, -4n), [[-4n, 0n]]);
  assert.deepEqual(legs(10n, -10n), [[-10n, 0n]]);
  assert.deepEqual(legs(10n, -14n), [[-10n, 0n], [-4n, openMargin(-4n, price, 5n)]]);
  assert.deepEqual(legs(-6n, 8n), [[6n, 0n], [2n, openMargin(2n, price, 5n)]]);
  assert.deepEqual(legs(7n, 0n), []);
});

test("marketId matches keccak256(bytes(model)) in Solidity", () => {
  assert.equal(marketId("glm-5.3"), "0x1125a5e4cc6d2592878c0498f3e69b293bc43718b5b92377c10c1f3defb7d1ba");
});

test("notional matches PerpMarket's abs(size) · price / 1e6", () => {
  assert.equal(notional(1_000_000n, 3_400_000n), 3_400_000n);
  assert.equal(notional(-2_000_000n, 1_500_000n), 3_000_000n);
});

test("openMargin clears PerpMarket's initial margin after the fee", () => {
  assert.equal(openMargin(10_000_000n, 153_000n, 5n), 322_831n);
  assert.ok((322_831n - 1_530n) * 5n >= notional(10_000_000n, 153_000n));
  assert.equal(openMargin(-10_000_000n, 153_000n, 5n), 322_831n);
  assert.equal(openMargin(1n, 1n, 5n), 2n);
});

test("long liquidation price matches test_LiquidationBoundaryAndReward", () => {
  const p = { size: 100_000_000n, margin: 100_500_000n, entryPrice: 5_000_000n, fundingOwed: 0n };
  assert.equal(liquidationPrice(p), 4_205_263n);
  assert.equal(liquidatable(p, 4_205_263n), true);
  assert.equal(liquidatable(p, 4_205_264n), false);
});

test("short liquidation price matches test_ShortLiquidationBoundary", () => {
  const p = { size: -100_000_000n, margin: 100_500_000n, entryPrice: 5_000_000n, fundingOwed: 0n };
  assert.equal(liquidationPrice(p), 5_719_048n);
  assert.equal(liquidatable(p, 5_719_047n), false);
});

test("funding owed moves the long liquidation price up", () => {
  const p = { size: 100_000_000n, margin: 100_500_000n, entryPrice: 5_000_000n, fundingOwed: 10_000_000n };
  assert.ok(liquidationPrice(p) > 4_205_263n);
});

test("unleveraged long is never liquidated and empty position has no price", () => {
  assert.equal(liquidationPrice({ size: 100_000_000n, margin: 600_000_000n, entryPrice: 5_000_000n, fundingOwed: 0n }), 0n);
  assert.equal(liquidationPrice({ size: 0n, margin: 0n, entryPrice: 0n, fundingOwed: 0n }), 0n);
});

test("a short already underwater at every price reads as liquidatable, not as never", () => {
  const p = { size: -100_000_000n, margin: 10_000_000n, entryPrice: 5_000_000n, fundingOwed: 600_000_000n };
  const price = liquidationPrice(p);
  assert.equal(price, 1n);
  assert.equal(liquidatable(p, 1n), true);
});
