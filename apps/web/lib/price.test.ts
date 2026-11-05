import assert from "node:assert/strict";
import test from "node:test";
import {
  blended,
  charge,
  estimatePromptTokens,
  marketPrice,
  mixedTokens,
  parseUsdPerToken,
  referenceFor,
  reservation,
  sellerEarning,
} from "./price.ts";
import type { Pricing, Rail } from "./types.ts";

const glm: Pricing = { prompt: 1_400_000n, completion: 4_400_000n };

const dailyRail = { resetPeriod: "daily" } as Rail;
const idleRail = { resetPeriod: null } as Rail;

test("parseUsdPerToken converts USD per token to micro per MTok", () => {
  assert.equal(parseUsdPerToken("0.000000264"), 264_000n);
  assert.equal(parseUsdPerToken("0.0000014"), 1_400_000n);
  assert.equal(parseUsdPerToken("4.4"), 4_400_000_000_000n);
  assert.equal(parseUsdPerToken("0.0000000000005"), 1n);
});

test("blended weights input three to one", () => {
  assert.equal(blended(glm), 2_150_000n);
});

test("the worked example holds", () => {
  assert.equal(mixedTokens(1000n, 1000n), 1000n);
  assert.equal(charge(1000n, 1_500_000n), 1500n);
});

test("mixedTokens is monotonic", () => {
  assert.ok(mixedTokens(10n, 0n) <= mixedTokens(11n, 0n));
  assert.ok(mixedTokens(0n, 10n) <= mixedTokens(0n, 11n));
});

test("seller earning floors the platform cut", () => {
  assert.equal(sellerEarning(123_457n, 1000n), 111_111n);
  assert.equal(sellerEarning(123_457n, 0n), 123_457n);
  assert.equal(sellerEarning(123_457n, 10_000n), 0n);
});

test("marketPrice falls back only on expiring credits", () => {
  assert.equal(marketPrice(900_000n, glm, dailyRail), 900_000n);
  assert.equal(marketPrice(null, glm, dailyRail), 1_935_000n);
  assert.equal(marketPrice(null, glm, idleRail), null);
});

test("reference picks the cheapest enabled rail", () => {
  const rails: Rail[] = [
    {
      id: "0g",
      protocol: "openai-chat",
      baseUrl: "https://example.invalid",
      auth: "key",
      extraHeaders: {},
      models: [{ canonical: "glm-5.3", upstream: "glm-5.3", listPrompt: 1_400_000n, listCompletion: 4_400_000n }],
      resetPeriod: "daily",
      enabled: true,
    },
    {
      id: "openrouter",
      protocol: "openai-chat",
      baseUrl: "https://example.invalid",
      auth: "key",
      extraHeaders: {},
      models: [{ canonical: "glm-5.3", upstream: "z-ai/glm", listPrompt: 2_000_000n, listCompletion: 6_000_000n }],
      resetPeriod: null,
      enabled: true,
    },
    {
      id: "openai",
      protocol: "openai-chat",
      baseUrl: "https://example.invalid",
      auth: "key",
      extraHeaders: {},
      models: [{ canonical: "glm-5.3", upstream: "gpt", listPrompt: 1n, listCompletion: 1n }],
      resetPeriod: null,
      enabled: false,
    },
  ];
  assert.equal(referenceFor("glm-5.3", rails)?.railId, "0g");
  assert.equal(referenceFor("missing", rails), null);
});

test("reservation covers the actual charge for a fixed sample", () => {
  const hold = reservation(1_500_000n, 3000, 512n);
  const actualTokens = mixedTokens(estimatePromptTokens(3000), 400n);
  assert.ok(hold.tokens >= actualTokens);
  assert.equal(hold.micro, charge(hold.tokens, 1_500_000n));
});
