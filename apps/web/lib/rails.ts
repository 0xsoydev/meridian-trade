import { parseUsdPerToken, referenceFor } from "./price.ts";
import type { Pricing, Rail, RailId, RailProtocol } from "./types";

type ModelSpec = { canonical: string; upstream: string };

type RailConfig = {
  id: RailId;
  protocol: RailProtocol;
  baseUrl: string;
  auth: "key" | "oauth";
  extraHeaders: Record<string, string>;
  resetPeriod: "daily" | "monthly" | null;
  models: ReadonlyArray<ModelSpec>;
};

type RawModel = {
  id: string;
  pricing_usd?: { prompt: string; completion: string };
  pricing?: { prompt: string; completion: string };
};

const CACHE_MS = 300_000;
let cache: { at: number; rails: Rail[] } | null = null;

function configs(): RailConfig[] {
  const list: RailConfig[] = [
    {
      id: "0g",
      protocol: "openai-chat",
      baseUrl: process.env.OG_ROUTER_URL ?? "https://router-api.0g.ai/v1",
      auth: "key",
      extraHeaders: {},
      resetPeriod: "daily",
      models: [
        { canonical: "glm-5.3", upstream: "glm-5.3" },
        { canonical: "deepseek-v4.1-flash", upstream: "deepseek-v4.1-flash" },
        { canonical: "claude-opus-5.5", upstream: "claude-opus-5.5" },
      ],
    },
    {
      id: "openrouter",
      protocol: "openai-chat",
      baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      models: [
        { canonical: "glm-5.3", upstream: "z-ai/glm-5.3" },
        { canonical: "deepseek-v4.1-flash", upstream: "deepseek/deepseek-v4.1-flash" },
        { canonical: "claude-opus-5.5", upstream: "anthropic/claude-opus-5.5" },
        { canonical: "gpt-6-sol", upstream: "openai/gpt-6-sol" },
      ],
    },
  ];
  const stub = process.env.STUB_RAIL_URL;
  if (stub) {
    list.push({
      id: "stub",
      protocol: "openai-chat",
      baseUrl: stub,
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      models: [
        { canonical: "glm-5.3", upstream: "glm-5.3" },
        { canonical: "deepseek-v4.1-flash", upstream: "deepseek-v4.1-flash" },
        { canonical: "claude-opus-5.5", upstream: "claude-opus-5.5" },
        { canonical: "gpt-6-sol", upstream: "gpt-6-sol" },
      ],
    });
  }
  return list;
}

function pricingOf(raw: RawModel): Pricing | null {
  const source = raw.pricing_usd ?? raw.pricing;
  if (!source) return null;
  const prompt = parseUsdPerToken(source.prompt);
  const completion = parseUsdPerToken(source.completion);
  if (prompt <= 0n || completion <= 0n) return null;
  return { prompt, completion };
}

async function loadRail(config: RailConfig): Promise<Rail | null> {
  const response = await fetch(`${config.baseUrl}/models`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: RawModel[] };
  const byId = new Map((body.data ?? []).map((entry) => [entry.id, entry]));
  const models = [];
  for (const spec of config.models) {
    const raw = byId.get(spec.upstream);
    if (!raw) continue;
    const pricing = pricingOf(raw);
    if (!pricing) continue;
    models.push({ canonical: spec.canonical, upstream: spec.upstream, listPrompt: pricing.prompt, listCompletion: pricing.completion });
  }
  if (models.length === 0) return null;
  return { ...config, models, enabled: true };
}

export async function catalog(): Promise<Rail[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rails;
  const loaded = await Promise.all(configs().map((config) => loadRail(config).catch(() => null)));
  const rails = loaded.filter((rail): rail is Rail => rail !== null);
  cache = { at: Date.now(), rails };
  return rails;
}

export async function reference(model: string): Promise<{ railId: RailId; pricing: Pricing } | null> {
  return referenceFor(model, await catalog());
}

export async function railPricing(railId: RailId, model: string): Promise<Pricing | null> {
  const rail = (await catalog()).find((entry) => entry.id === railId);
  const match = rail?.models.find((entry) => entry.canonical === model);
  return match ? { prompt: match.listPrompt, completion: match.listCompletion } : null;
}
