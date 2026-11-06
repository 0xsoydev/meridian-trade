import { z } from "zod";
import { blended, parseUsdPerToken, referenceFor } from "./price.ts";
import type { Pricing, Rail, RailCheck, RailId, RailModel, RailProtocol, Verifiability } from "./types";

type RailConfig = {
  id: RailId;
  protocol: RailProtocol;
  baseUrl: string;
  modelsUrl: string;
  check: RailCheck;
  auth: "key" | "oauth";
  extraHeaders: Record<string, string>;
  resetPeriod: "daily" | "monthly" | null;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  models: "live" | "ranked" | ReadonlyArray<string>;
};

const priceSchema = z.object({ prompt: z.string(), completion: z.string() });

const modelSchema = z.object({
  id: z.string(),
  canonical_slug: z.string().optional().catch(undefined),
  pricing_usd: priceSchema.optional().catch(undefined),
  pricing: priceSchema.optional().catch(undefined),
  verifiability: z.unknown().optional(),
  supported_endpoints: z.array(z.string()).optional().catch(undefined),
});

type RawModel = z.infer<typeof modelSchema>;

const listSchema = z.object({ data: z.array(z.unknown()) });

const rankingSchema = z.object({
  data: z.array(z.object({ date: z.string(), model_permaslug: z.string(), total_tokens: z.coerce.bigint() })),
});

const ZEN_MODELS = [
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.2",
  "glm-5.1",
  "glm-5",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "kimi-k2.5",
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "mistral-large-4",
  "qwen3.8-max",
];

const GO_MODELS = [
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.2",
  "kimi-k3.1-pro",
  "kimi-k3",
  "kimi-k2.7-code",
  "longcat-2.0",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "mimo-v2.6-flash",
  "mimo-v2.6-pro",
  "mimo-v2.5",
  "mimo-v2.5-pro",
  "minimax-m3.1-flash",
  "hy4-preview",
  "hy3",
  "step-5-preview",
];

const CACHE_MS = 300_000;
const RANKING_MS = 21_600_000;
const RANKED_MODELS = 30;
let cache: { at: number; rails: Rail[] } | null = null;
let ranking: { at: number; slugs: string[] } | null = null;

function configs(): RailConfig[] {
  const og = process.env.OG_ROUTER_URL ?? "https://router-api.0g.ai/v1";
  const openrouter = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const commandcode = process.env.COMMANDCODE_BASE_URL ?? "https://api.commandcode.ai/provider/v1";
  const anthropic = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1";
  const openai = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const list: RailConfig[] = [
    {
      id: "0g",
      protocol: "openai-chat",
      baseUrl: og,
      modelsUrl: process.env.OG_MODELS_URL ?? "https://router-api.0g.ai/v1/models",
      check: "probe",
      auth: "key",
      extraHeaders: {},
      resetPeriod: "daily",
      models: "live",
    },
    {
      id: "openrouter",
      protocol: "openai-chat",
      baseUrl: openrouter,
      modelsUrl: `${openrouter}/models`,
      check: "key",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      models: "ranked",
    },
    {
      id: "commandcode",
      protocol: "openai-chat",
      baseUrl: commandcode,
      modelsUrl: `${commandcode}/models`,
      check: "chat",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      maxTokensField: "max_completion_tokens",
      models: "live",
    },
    {
      id: "zen",
      protocol: "openai-chat",
      baseUrl: process.env.ZEN_BASE_URL ?? "https://opencode.ai/inference/openai/v1",
      modelsUrl: "https://opencode.ai/zen/v1/models",
      check: "models",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      models: ZEN_MODELS,
    },
    {
      id: "opencode-go",
      protocol: "openai-chat",
      baseUrl: process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/inference/go/openai/v1",
      modelsUrl: "https://opencode.ai/zen/go/v1/models",
      check: "models",
      auth: "key",
      extraHeaders: { "user-agent": "celestial-trade/1.0" },
      resetPeriod: null,
      models: GO_MODELS,
    },
    {
      id: "anthropic",
      protocol: "openai-chat",
      baseUrl: anthropic,
      modelsUrl: `${anthropic}/models`,
      check: "models",
      auth: "key",
      extraHeaders: { "anthropic-version": "2023-06-01" },
      resetPeriod: null,
      models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    },
    {
      id: "openai",
      protocol: "openai-chat",
      baseUrl: openai,
      modelsUrl: `${openai}/models`,
      check: "models",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      maxTokensField: "max_completion_tokens",
      models: ["gpt-6-astra", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"],
    },
  ];
  const stub = process.env.STUB_RAIL_URL;
  if (stub) {
    list.push({
      id: "stub",
      protocol: "openai-chat",
      baseUrl: stub,
      modelsUrl: `${stub}/models`,
      check: "models",
      auth: "key",
      extraHeaders: {},
      resetPeriod: null,
      models: "live",
    });
  }
  return list;
}

export function canonicalId(id: string): string {
  const name = (id.split("/").at(-1) ?? id).toLowerCase();
  return /^claude-[a-z]+-\d+-\d+$/.test(name) ? name.replace(/-(\d+)$/, ".$1") : name;
}

function pricingOf(raw: RawModel): Pricing | null {
  const source = raw.pricing_usd ?? raw.pricing;
  if (!source) return null;
  try {
    const prompt = parseUsdPerToken(source.prompt);
    const completion = parseUsdPerToken(source.completion);
    return prompt > 0n && completion > 0n ? { prompt, completion } : null;
  } catch {
    return null;
  }
}

function verifiabilityOf(raw: RawModel): Verifiability {
  return raw.verifiability === "TeeML" || raw.verifiability === "TeeTLS" ? raw.verifiability : null;
}

async function fetchModels(url: string): Promise<RawModel[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return listSchema.parse(await response.json()).data.flatMap((entry) => {
    const parsed = modelSchema.safeParse(entry);
    return parsed.success && !parsed.data.id.includes(":") ? [parsed.data] : [];
  });
}

function cheapest(models: ReadonlyArray<RawModel>): Map<string, Pricing> {
  const prices = new Map<string, Pricing>();
  for (const model of models) {
    const pricing = pricingOf(model);
    if (!pricing) continue;
    const canonical = canonicalId(model.id);
    const known = prices.get(canonical);
    if (!known || blended(pricing) < blended(known)) prices.set(canonical, pricing);
  }
  return prices;
}

async function rankedSlugs(base: string): Promise<string[]> {
  if (ranking && Date.now() - ranking.at < RANKING_MS) return ranking.slugs;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];
  const response = await fetch(`${base}/datasets/rankings-daily?period=week`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return ranking?.slugs ?? [];
  const rows = rankingSchema.parse(await response.json()).data;
  const latest = rows.reduce((max, row) => (row.date > max ? row.date : max), "");
  const slugs = rows
    .filter((row) => row.date === latest && row.model_permaslug !== "other")
    .sort((a, b) => (a.total_tokens === b.total_tokens ? 0 : a.total_tokens < b.total_tokens ? 1 : -1))
    .slice(0, RANKED_MODELS)
    .map((row) => row.model_permaslug);
  ranking = { at: Date.now(), slugs };
  return slugs;
}

async function loadRail(
  config: RailConfig,
  oracle: ReadonlyArray<RawModel>,
  prices: ReadonlyMap<string, Pricing>,
): Promise<Rail | null> {
  const models: RailModel[] = [];
  const add = (upstream: string, pricing: Pricing | null | undefined, verifiability: Verifiability) => {
    const canonical = canonicalId(upstream);
    if (!pricing || models.some((model) => model.canonical === canonical)) return;
    models.push({ canonical, upstream, listPrompt: pricing.prompt, listCompletion: pricing.completion, verifiability });
  };

  if (config.models === "ranked") {
    for (const slug of await rankedSlugs(config.baseUrl)) {
      const raw = oracle.find((model) => model.canonical_slug === slug || model.id === slug);
      if (raw) add(raw.id, pricingOf(raw), verifiabilityOf(raw));
    }
  } else if (config.models === "live") {
    for (const raw of await fetchModels(config.modelsUrl)) {
      if (raw.supported_endpoints && !raw.supported_endpoints.includes("/chat/completions")) continue;
      add(raw.id, pricingOf(raw) ?? prices.get(canonicalId(raw.id)), verifiabilityOf(raw));
    }
  } else {
    for (const upstream of config.models) add(upstream, prices.get(canonicalId(upstream)), null);
  }

  if (models.length === 0) return null;
  return { ...config, models, enabled: true };
}

export async function catalog(): Promise<Rail[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rails;
  const list = configs();
  const openrouter = list.find((config) => config.id === "openrouter");
  const oracle = openrouter ? await fetchModels(openrouter.modelsUrl).catch(() => []) : [];
  const prices = cheapest(oracle);
  const loaded = await Promise.all(list.map((config) => loadRail(config, oracle, prices).catch(() => null)));
  const rails = loaded.filter((rail): rail is Rail => rail !== null);
  cache = { at: Date.now(), rails };
  return rails;
}

export async function reference(model: string): Promise<{ railId: RailId; pricing: Pricing } | null> {
  return referenceFor(model, await catalog());
}
