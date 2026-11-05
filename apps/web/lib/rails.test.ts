import assert from "node:assert/strict";
import test from "node:test";
import { catalog, reference } from "./rails.ts";

process.env.OG_ROUTER_URL = "http://127.0.0.1:1";
process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:1";
delete process.env.STUB_RAIL_URL;

test("seeded rails exist without any catalog request", async () => {
  const rails = await catalog();
  assert.deepEqual(
    rails.map((rail) => rail.id).sort(),
    ["anthropic", "openai"],
  );

  const anthropic = rails.find((rail) => rail.id === "anthropic");
  assert.ok(anthropic);
  assert.equal(anthropic.resetPeriod, null);
  assert.equal(anthropic.maxTokensField, undefined);
  assert.deepEqual(
    anthropic.models.map((model) => [model.canonical, model.listPrompt, model.listCompletion, model.verifiability]),
    [
      ["claude-opus-5.5", 4_000_000n, 20_000_000n, null],
      ["claude-sonnet-5.5", 2_000_000n, 10_000_000n, null],
      ["claude-haiku-5.5", 100_000n, 500_000n, null],
      ["claude-fable-5.1", 10_000_000n, 50_000_000n, null],
    ],
  );

  const openai = rails.find((rail) => rail.id === "openai");
  assert.ok(openai);
  assert.equal(openai.maxTokensField, "max_completion_tokens");
  assert.deepEqual(
    openai.models.map((model) => [model.canonical, model.listPrompt, model.listCompletion]),
    [
      ["gpt-6-sol", 2_000_000n, 10_000_000n],
      ["gpt-6.1-sol", 2_000_000n, 10_000_000n],
      ["gpt-6.1-terra", 1_000_000n, 5_000_000n],
      ["gpt-6-luna", 100_000n, 500_000n],
    ],
  );
});

test("reference resolves through the seeded rails", async () => {
  const cheapest = await reference("claude-opus-5.5");
  assert.equal(cheapest?.railId, "anthropic");
  assert.equal(cheapest?.pricing.prompt, 4_000_000n);
  assert.equal(cheapest?.pricing.completion, 20_000_000n);
  assert.equal(await reference("no-such-model"), null);
});
