import assert from "node:assert/strict";
import test from "node:test";
import {
  blended,
  candlesFromPoints,
  charge,
  estimatePromptTokens,
  fillsToPoints,
  formatMicroPerMtok,
  formatMtok,
  formatUsd,
  marketPrice,
  mixedTokens,
  parseMtok,
  parseUsd,
  parseUsdPerToken,
  previewFill,
  referenceFor,
  reservation,
  sellerEarning,
} from "./price.ts";
import type { Pricing, Rail } from "./types.ts";

const glm: Pricing = { prompt: 1_400_000n, completion: 4_400_000n };

const dailyRail = { resetPeriod: "daily" } as Rail;
const idleRail = { resetPeriod: null } as Rail;

test("MTok inputs and token counts round-trip at the boundary", () => {
  assert.equal(parseMtok("10"), 10_000_000n);
  assert.equal(parseMtok("1.5"), 1_500_000n);
  assert.equal(parseMtok("1,000"), 1_000_000_000n);
  assert.equal(parseMtok("0.000001"), 1n);
  assert.equal(parseMtok("junk"), 0n);
  assert.equal(parseMtok("10."), 0n);
  assert.equal(formatMtok(10_000_000n), "10");
  assert.equal(formatMtok(1_500_000n), "1.5");
  assert.equal(formatMtok(1_000n), "0.001");
  assert.equal(formatMtok(1_200_000_000n), "1,200");
  assert.equal(formatUsd(1_400_000n), "$1.40");
  assert.equal(formatUsd(700_000n), "$0.70");
  assert.equal(formatUsd(0n), "$0.00");
  assert.equal(formatUsd(5_000n), "$0.005");
});

test("parseUsdPerToken converts USD per token to micro per MTok", () => {
  assert.equal(parseUsdPerToken("0.000000264"), 264_000n);
  assert.equal(parseUsdPerToken("0.0000014"), 1_400_000n);
  assert.equal(parseUsdPerToken("4.4"), 4_400_000_000_000n);
  assert.equal(parseUsdPerToken("0.0000000000005"), 1n);
});

test("formatMicroPerMtok prints at least cents and keeps provider decimals", () => {
  assert.equal(formatMicroPerMtok(1_400_000n), "1.40");
  assert.equal(formatMicroPerMtok(90_000n), "0.09");
  assert.equal(formatMicroPerMtok(1_000_000n), "1.00");
  assert.equal(formatMicroPerMtok(158_750n), "0.15875");
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
      modelsUrl: "https://example.invalid/models",
      check: "probe",
      auth: "key",
      extraHeaders: {},
      models: [
        { canonical: "glm-5.3", upstream: "glm-5.3", listPrompt: 1_400_000n, listCompletion: 4_400_000n, verifiability: "TeeML" },
      ],
      resetPeriod: "daily",
      enabled: true,
    },
    {
      id: "openrouter",
      protocol: "openai-chat",
      baseUrl: "https://example.invalid",
      modelsUrl: "https://example.invalid/models",
      check: "key",
      auth: "key",
      extraHeaders: {},
      models: [
        { canonical: "glm-5.3", upstream: "z-ai/glm", listPrompt: 2_000_000n, listCompletion: 6_000_000n, verifiability: null },
      ],
      resetPeriod: null,
      enabled: true,
    },
    {
      id: "openai",
      protocol: "openai-chat",
      baseUrl: "https://example.invalid",
      modelsUrl: "https://example.invalid/models",
      check: "models",
      auth: "key",
      extraHeaders: {},
      models: [{ canonical: "glm-5.3", upstream: "gpt", listPrompt: 1n, listCompletion: 1n, verifiability: null }],
      resetPeriod: null,
      enabled: false,
    },
  ];
  assert.equal(referenceFor("glm-5.3", rails)?.railId, "0g");
  assert.equal(referenceFor("missing", rails), null);
});

test("parseUsd converts dollars to micro exactly and rejects junk", () => {
  assert.equal(parseUsd("0.50"), 500_000n);
  assert.equal(parseUsd("20"), 20_000_000n);
  assert.equal(parseUsd("0.000001"), 1n);
  assert.equal(parseUsd("1.0000001"), null);
  assert.equal(parseUsd("-1"), null);
  assert.equal(parseUsd("1e3"), null);
});

test("reservation covers the actual charge for a fixed sample", () => {
  const hold = reservation(1_500_000n, 3000, 512n);
  const actualTokens = mixedTokens(estimatePromptTokens(3000), 400n);
  assert.ok(hold.tokens >= actualTokens);
  assert.equal(hold.micro, charge(hold.tokens, 1_500_000n));
});

const previewAsks = [
  { price_micro_per_mtok: "1400000", tokens_left: "500" },
  { price_micro_per_mtok: "1500000", tokens_left: "1000" },
];

test("the fill preview walks the sorted book and splits the fee", () => {
  const inside = previewFill(previewAsks, 1200n, 1000n);
  assert.equal(inside.fillable, 1200n);
  assert.equal(inside.cost, 1750n);
  assert.equal(inside.avg, 1_458_333n);
  assert.equal(inside.fee, 175n);
  assert.equal(inside.net, 1575n);
  assert.equal(inside.partial, false);

  const beyond = previewFill(previewAsks, 2000n, 1000n);
  assert.equal(beyond.fillable, 1500n);
  assert.equal(beyond.cost, 2200n);
  assert.equal(beyond.partial, true);
});

test("a 1M MTok listing at $1.40 produces the expected notional and seller net", () => {
  const price = parseUsd("1.40");
  assert.ok(price !== null);
  const notional = charge(1_000_000n * 1_000_000n, price);
  assert.equal(notional, 1_400_000_000_000n);
  assert.equal(sellerEarning(notional, 1000n), 1_260_000_000_000n);
});

test("every fill reaches its candle, and each candle opens at the previous close", () => {
  const fills = [
    { listing_id: "c", tokens: "250000", price_micro_per_mtok: "100000", created_at: "2026-11-01T10:02:10.000Z" },
    { listing_id: "b", tokens: "250000", price_micro_per_mtok: "174600", created_at: "2026-11-01T10:01:30.125Z" },
    { listing_id: "a", tokens: "250000", price_micro_per_mtok: "153000", created_at: "2026-11-01T10:01:30.120Z" },
    { listing_id: "a", tokens: "500000", price_micro_per_mtok: "160000", created_at: "2026-11-01T10:00:05.000Z" },
  ];
  const points = fillsToPoints(fills);
  const at = (iso: string) => Date.parse(iso) / 1000;
  const ohlcv = (bucket: number) =>
    candlesFromPoints(points, bucket).map(({ time, open, high, low, close, volume }) => [time, open, high, low, close, volume]);

  assert.deepEqual(ohlcv(60), [
    [at("2026-11-01T10:00:00Z"), 0.16, 0.16, 0.16, 0.16, 0.5],
    [at("2026-11-01T10:01:00Z"), 0.16, 0.1746, 0.153, 0.1746, 0.5],
    [at("2026-11-01T10:02:00Z"), 0.1746, 0.1746, 0.1, 0.1, 0.25],
  ]);
  assert.deepEqual(ohlcv(300), [[at("2026-11-01T10:00:00Z"), 0.16, 0.1746, 0.1, 0.1, 1.25]]);
  assert.equal(fillsToPoints(fills, Date.parse("2026-11-01T10:01:00Z")).length, 3);
});
