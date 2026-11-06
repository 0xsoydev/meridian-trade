import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { POST as sellerRpSignature } from "../app/api/sellers/rp-signature/route.ts";
import { nullifierToDecimal, signalHash, verifyWorld, worldEnvironment } from "./world.ts";

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

test("the World bypass answers a stable test nullifier and never runs in production", async () => {
  const bypass = process.env.NEXT_PUBLIC_WORLD_BYPASS;
  const nodeEnv = process.env.NODE_ENV;
  process.env.NEXT_PUBLIC_WORLD_BYPASS = "true";
  try {
    const first = await verifyWorld({}, { action: "seller", signal: "0xabc" });
    assert.ok("worldNullifier" in first);
    assert.deepEqual(await verifyWorld({}, { action: "seller", signal: "0xabc" }), first);
    assert.notDeepEqual(await verifyWorld({}, { action: "seller", signal: "0xabd" }), first);
    process.env.NEXT_PUBLIC_WORLD_BYPASS = "TRUE";
    assert.ok("error" in (await verifyWorld({}, { action: "seller", signal: "0xabc" })));
    process.env.NEXT_PUBLIC_WORLD_BYPASS = "true";
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.ok("error" in (await verifyWorld({}, { action: "seller", signal: "0xabc" })));
  } finally {
    if (bypass === undefined) delete process.env.NEXT_PUBLIC_WORLD_BYPASS;
    else process.env.NEXT_PUBLIC_WORLD_BYPASS = bypass;
    if (nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: nodeEnv });
  }
});

test("the seller rp-signature carries what IDKit needs", async () => {
  process.env.WORLD_RP_ID = "rp_test";
  process.env.WORLD_APP_ID = "app_test";
  process.env.WORLD_RP_SIGNING_KEY = "11".repeat(32);
  const response = await sellerRpSignature();
  assert.equal(response.status, 200);
  z.object({
    sig: z.string(),
    nonce: z.string(),
    created_at: z.number(),
    expires_at: z.number(),
    rp_id: z.literal("rp_test"),
    app_id: z.literal("app_test"),
    environment: z.string(),
    action: z.literal("seller"),
  }).parse(await response.json());
});
