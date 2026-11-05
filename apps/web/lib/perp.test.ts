import assert from "node:assert/strict";
import test from "node:test";
import { liquidatable, liquidationPrice, marketId } from "./perp.ts";

test("marketId matches keccak256(bytes(model)) in Solidity", () => {
  assert.equal(marketId("glm-5.3"), "0x1125a5e4cc6d2592878c0498f3e69b293bc43718b5b92377c10c1f3defb7d1ba");
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
