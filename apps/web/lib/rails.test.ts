import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { canonicalId, catalog, reference } from "./rails.ts";

const price = (prompt: string, completion: string) => ({ prompt, completion });
let server: ReturnType<typeof createServer> | null = null;
let rankingAuth = "";

before(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? "";
    const send = (body: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (url === "/or/models") {
      send({
        data: [
          { id: "z-ai/glm-5.3", canonical_slug: "z-ai/glm-5.3-20260816", pricing: price("0.0000000699", "0.0000014") },
          { id: "z-ai/glm-5.3-flash", canonical_slug: "z-ai/glm-5.3-flash", pricing: price("0.0000000163", "0.0000001479") },
          { id: "anthropic/claude-opus-5.5", canonical_slug: "anthropic/claude-opus-5.5-20261001", pricing: price("0.000004", "0.00002") },
          { id: "openai/gpt-6-sol", canonical_slug: "openai/gpt-6-sol", pricing: price("0.000002", "0.00001") },
          { id: "openai/gpt-6-sol:batch", pricing: price("0.000001", "0.000005") },
          { id: "meta/free-model", pricing: price("0", "0") },
          { id: "broken/model", pricing: { prompt: 1 } },
        ],
      });
      return;
    }
    if (url === "/og/models") {
      send({ data: [{ id: "0gm-1.0-35b-a3b", pricing_usd: price("0.00000008", "0.00000048") }] });
      return;
    }
    if (url.startsWith("/or/datasets/rankings-daily")) {
      rankingAuth = request.headers.authorization ?? "";
      send({
        data: [
          { date: "2026-10-19", model_permaslug: "openai/gpt-6-sol", total_tokens: "999999" },
          { date: "2026-10-26", model_permaslug: "z-ai/glm-5.3-20260816", total_tokens: "500" },
          { date: "2026-10-26", model_permaslug: "anthropic/claude-opus-5.5-20261001", total_tokens: "900" },
          { date: "2026-10-26", model_permaslug: "other", total_tokens: "5000" },
        ],
      });
      return;
    }
    if (url === "/cc/models") {
      send({
        data: [
          { id: "zai-org/GLM-5.3", supported_endpoints: ["/chat/completions"] },
          { id: "z-ai/glm-5.3-flash", supported_endpoints: ["/chat/completions", "/responses"] },
          { id: "claude-opus-5-5", supported_endpoints: ["/messages"] },
          { id: "nobody/unpriced-model", supported_endpoints: ["/chat/completions"] },
          { id: "stealth/glyph:free", supported_endpoints: ["/chat/completions"] },
        ],
      });
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.OPENROUTER_BASE_URL = `${url}/or`;
  process.env.COMMANDCODE_BASE_URL = `${url}/cc`;
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.OG_ROUTER_URL = "http://127.0.0.1:1";
  process.env.OG_MODELS_URL = `${url}/og/models`;
  delete process.env.STUB_RAIL_URL;
});

after(() => {
  server?.closeAllConnections();
  server?.close();
});

test("canonical ids drop the vendor, lowercase and dot Claude versions", () => {
  assert.equal(canonicalId("zai-org/GLM-5.3"), "glm-5.3");
  assert.equal(canonicalId("z-ai/glm-5.3"), "glm-5.3");
  assert.equal(canonicalId("claude-opus-5-5"), "claude-opus-5.5");
  assert.equal(canonicalId("anthropic/claude-opus-5.5"), "claude-opus-5.5");
  assert.equal(canonicalId("claude-haiku-4-5-20251001"), "claude-haiku-4-5-20251001");
  assert.equal(canonicalId("gpt-6.1-sol"), "gpt-6.1-sol");
});

test("Command Code lists its chat models live, priced from OpenRouter", async () => {
  const rail = (await catalog()).find((entry) => entry.id === "commandcode");
  assert.ok(rail);
  assert.equal(rail.check, "chat");
  assert.deepEqual(
    rail.models.map((model) => [model.canonical, model.upstream, model.listPrompt, model.listCompletion]),
    [
      ["glm-5.3", "zai-org/GLM-5.3", 69_900n, 1_400_000n],
      ["glm-5.3-flash", "z-ai/glm-5.3-flash", 16_300n, 147_900n],
    ],
  );
});

test("OpenRouter lists its top models by tokens in the latest week, with its own prices", async () => {
  const rail = (await catalog()).find((entry) => entry.id === "openrouter");
  assert.ok(rail);
  assert.equal(rankingAuth, "Bearer sk-or-test");
  assert.equal(rail.check, "key");
  assert.deepEqual(
    rail.models.map((model) => [model.canonical, model.upstream, model.listPrompt]),
    [
      ["claude-opus-5.5", "anthropic/claude-opus-5.5", 4_000_000n],
      ["glm-5.3", "z-ai/glm-5.3", 69_900n],
    ],
  );
});

test("key-scoped rails keep their priced chat models and check the seller's model list", async () => {
  const rails = await catalog();
  const anthropic = rails.find((entry) => entry.id === "anthropic");
  assert.ok(anthropic);
  assert.equal(anthropic.check, "models");
  assert.equal(anthropic.modelsUrl, "https://api.anthropic.com/v1/models");
  assert.deepEqual(
    anthropic.models.map((model) => [model.canonical, model.upstream, model.listCompletion]),
    [["claude-opus-5.5", "claude-opus-5-5", 20_000_000n]],
  );

  const openai = rails.find((entry) => entry.id === "openai");
  assert.deepEqual(openai?.models.map((model) => [model.canonical, model.listPrompt]), [["gpt-6-sol", 2_000_000n]]);

  const zen = rails.find((entry) => entry.id === "zen");
  assert.equal(zen?.modelsUrl, "https://opencode.ai/zen/v1/models");
  assert.deepEqual(zen?.models.map((model) => model.canonical), ["glm-5.3", "glm-5.3-flash"]);

  const go = rails.find((entry) => entry.id === "opencode-go");
  assert.equal(go?.extraHeaders["user-agent"], "celestial-trade/1.0");
  assert.deepEqual(go?.models.map((model) => model.canonical), ["glm-5.3", "glm-5.3-flash"]);
});

test("0G is priced from its public model list while requests still go to its router", async () => {
  const og = (await catalog()).find((entry) => entry.id === "0g");
  assert.ok(og);
  assert.equal(og.baseUrl, "http://127.0.0.1:1");
  assert.equal(og.resetPeriod, "daily");
  assert.deepEqual(
    og.models.map((model) => [model.canonical, model.listPrompt, model.listCompletion]),
    [["0gm-1.0-35b-a3b", 80_000n, 480_000n]],
  );
});

test("reference picks the cheapest listed price and misses unknown models", async () => {
  const cheapest = await reference("glm-5.3");
  assert.ok(cheapest);
  assert.equal(cheapest.pricing.prompt, 69_900n);
  assert.equal(cheapest.pricing.completion, 1_400_000n);
  assert.equal(await reference("no-such-model"), null);
});
