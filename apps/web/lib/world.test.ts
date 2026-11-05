import assert from "node:assert/strict";
import test from "node:test";
import { nullifierToDecimal, signalHash, worldEnvironment } from "./world.ts";

test("nullifierToDecimal accepts hex and decimal", () => {
  assert.equal(nullifierToDecimal("0x01"), "1");
  assert.equal(nullifierToDecimal("0x0f"), "15");
  assert.equal(nullifierToDecimal("12345"), "12345");
  assert.equal(nullifierToDecimal(" 0xFF "), "255");
});

test("nullifierToDecimal rejects malformed values", () => {
  assert.equal(nullifierToDecimal(""), null);
  assert.equal(nullifierToDecimal("0x"), null);
  assert.equal(nullifierToDecimal("0xzz"), null);
  assert.equal(nullifierToDecimal("12.5"), null);
  assert.equal(nullifierToDecimal("-1"), null);
  assert.equal(nullifierToDecimal(`0x${"f".repeat(65)}`), null);
});

test("signalHash is a keccak over the utf8 signal", () => {
  assert.match(signalHash("0xabc"), /^0x[0-9a-f]{64}$/);
  assert.notEqual(signalHash("0xabc"), signalHash("0xabd"));
  assert.equal(signalHash("0xabc"), signalHash("0xabc"));
});

test("worldEnvironment defaults to production", () => {
  const previous = process.env.WORLD_ENV;
  delete process.env.WORLD_ENV;
  assert.equal(worldEnvironment(), "production");
  if (previous === undefined) delete process.env.WORLD_ENV;
  else process.env.WORLD_ENV = previous;
});
