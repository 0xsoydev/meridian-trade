import assert from "node:assert/strict";
import test from "node:test";
import { open, seal } from "./secrets.ts";

process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

test("seal round-trips and hides the plaintext", () => {
  const sealed = seal("sk-live-secret");
  assert.ok(!sealed.includes("sk-live-secret"));
  assert.equal(open(sealed), "sk-live-secret");
});

test("seal uses a fresh nonce", () => {
  assert.notEqual(seal("same"), seal("same"));
});

test("tampering is rejected", () => {
  const [iv, tag, body] = seal("value").split(".");
  assert.ok(iv && tag && body);
  const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
  assert.throws(() => open([iv, tag, flipped].join(".")));
});
