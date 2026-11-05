import assert from "node:assert/strict";
import test from "node:test";
import { liquidatable, liquidationPrice, marketId, notional, openMargin } from "./perp.ts";

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
