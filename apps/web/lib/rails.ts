import { parseUsd, parseUsdPerToken, referenceFor } from "./price.ts";
import type { Pricing, Rail, RailId, RailModel, RailProtocol, Verifiability } from "./types";

type ModelSpec = {
  canonical: string;
  upstream: string;
  listPrompt?: string;
  listCompletion?: string;
};

type RailConfig = {
  id: RailId;
  protocol: RailProtocol;
  baseUrl: string;
  auth: "key" | "oauth";
  extraHeaders: Record<string, string>;
  resetPeriod: "daily" | "monthly" | null;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  models: ReadonlyArray<ModelSpec> | "all";
};

type RawModel = {
  id: string;
  pricing_usd?: { prompt: string; completion: string };
  pricing?: { prompt: string; completion: string };
  verifiability?: unknown;
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
    {
      id: "anthropic",
      protocol: "openai-chat",
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      models: [
        { canonical: "claude-opus-5.5", upstream: "claude-opus-5.5", listPrompt: "4", listCompletion: "20" },
        { canonical: "claude-sonnet-5.5", upstream: "claude-sonnet-5.5", listPrompt: "2", listCompletion: "10" },
        { canonical: "claude-haiku-5.5", upstream: "claude-haiku-5.5", listPrompt: "0.10", listCompletion: "0.50" },
        { canonical: "claude-fable-5.1", upstream: "claude-fable-5.1", listPrompt: "10", listCompletion: "50" },
      ],
    },
    {
      id: "openai",
      protocol: "openai-chat",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      maxTokensField: "max_completion_tokens",
      models: [
        { canonical: "gpt-6-sol", upstream: "gpt-6-sol", listPrompt: "2", listCompletion: "10" },
        { canonical: "gpt-6.1-sol", upstream: "gpt-6.1-sol", listPrompt: "2", listCompletion: "10" },
        { canonical: "gpt-6.1-terra", upstream: "gpt-6.1-terra", listPrompt: "1", listCompletion: "5" },
        { canonical: "gpt-6-luna", upstream: "gpt-6-luna", listPrompt: "0.10", listCompletion: "0.50" },
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
      models: "all",
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

function verifiabilityOf(raw: RawModel): Verifiability {
  return raw.verifiability === "TeeML" || raw.verifiability === "TeeTLS" ? raw.verifiability : null;
}

function seededModels(models: ReadonlyArray<ModelSpec>): RailModel[] | null {
  const result: RailModel[] = [];
  for (const spec of models) {
    if (spec.listPrompt === undefined || spec.listCompletion === undefined) return null;
    const prompt = parseUsd(spec.listPrompt);
    const completion = parseUsd(spec.listCompletion);
    if (prompt === null || completion === null || prompt <= 0n || completion <= 0n) return null;
    result.push({
      canonical: spec.canonical,
      upstream: spec.upstream,
      listPrompt: prompt,
      listCompletion: completion,
      verifiability: null,
    });
  }
  return result.length > 0 ? result : null;
}

async function loadRail(config: RailConfig): Promise<Rail | null> {
  if (config.models !== "all" && config.models.some((spec) => spec.listPrompt !== undefined || spec.listCompletion !== undefined)) {
    const models = seededModels(config.models);
    return models ? { ...config, models, enabled: true } : null;
  }

  const response = await fetch(`${config.baseUrl}/models`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: RawModel[] };
  const data = body.data ?? [];
  const byId = new Map(data.map((entry) => [entry.id, entry]));
  const specs = config.models === "all" ? data.map((entry) => ({ canonical: entry.id, upstream: entry.id })) : config.models;
  const models: RailModel[] = [];
  for (const spec of specs) {
    const raw = byId.get(spec.upstream);
    if (!raw) continue;
    const pricing = pricingOf(raw);
    if (!pricing) continue;
    models.push({
      canonical: spec.canonical,
      upstream: spec.upstream,
      listPrompt: pricing.prompt,
      listCompletion: pricing.completion,
      verifiability: verifiabilityOf(raw),
    });
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
