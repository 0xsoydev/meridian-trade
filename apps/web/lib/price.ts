import type { Micro, MicroPerMTok, Pricing, Rail, RailId } from "./types";

const MICRO_PER_MTOK = 1_000_000n;
const PRICE_SCALE = 12;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function parseUsdPerToken(decimal: string): MicroPerMTok {
  const trimmed = decimal.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const parts = body.split(".");
  const wholePart = parts[0] ?? "";
  const fractionPart = parts[1] ?? "";
  if (!/^\d+$/.test(wholePart) || !/^\d*$/.test(fractionPart)) {
    throw new Error("invalid price");
  }
  const padded = (fractionPart + "0".repeat(PRICE_SCALE)).slice(0, PRICE_SCALE);
  const remainder = fractionPart.length > PRICE_SCALE && /[1-9]/.test(fractionPart.slice(PRICE_SCALE));
  const value = BigInt(wholePart + padded) + (remainder ? 1n : 0n);
  return negative ? -value : value;
}

export function formatMicroPerMtok(value: MicroPerMTok): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function blended(p: Pricing): MicroPerMTok {
  return (3n * p.prompt + p.completion) / 4n;
}

export function referenceFor(
  model: string,
  rails: ReadonlyArray<Rail>,
): { railId: RailId; pricing: Pricing } | null {
  let best: { railId: RailId; pricing: Pricing } | null = null;
  for (const rail of rails) {
    if (!rail.enabled) continue;
    const match = rail.models.find((entry) => entry.canonical === model);
    if (!match) continue;
    const pricing: Pricing = { prompt: match.listPrompt, completion: match.listCompletion };
    if (!best || blended(pricing) < blended(best.pricing)) best = { railId: rail.id, pricing };
  }
  return best;
}

export function mixedTokens(promptTokens: bigint, completionTokens: bigint): bigint {
  return ceilDiv(3n * promptTokens + completionTokens, 4n);
}

export function charge(tokens: bigint, ask: MicroPerMTok): Micro {
  return ceilDiv(tokens * ask, MICRO_PER_MTOK);
}

export function sellerEarning(chargeMicro: Micro, takeBps: bigint): Micro {
  return (chargeMicro * (10_000n - takeBps)) / 10_000n;
}

export function railCost(p: Pricing, promptTokens: bigint, completionTokens: bigint): Micro {
  return ceilDiv(promptTokens * p.prompt + completionTokens * p.completion, MICRO_PER_MTOK);
}

export function marketPrice(
  bestLimitAsk: MicroPerMTok | null,
  ref: Pricing,
  rail: Rail,
): MicroPerMTok | null {
  if (bestLimitAsk !== null) return bestLimitAsk;
  if (rail.resetPeriod === null) return null;
  return (blended(ref) * 9n) / 10n;
}

export function estimatePromptTokens(utf8Bytes: number): bigint {
  if (!Number.isInteger(utf8Bytes) || utf8Bytes < 0) throw new Error("invalid byte count");
  return ceilDiv(BigInt(utf8Bytes), 3n);
}

export function reservation(
  ask: MicroPerMTok,
  utf8Bytes: number,
  maxTokens: bigint,
): { tokens: bigint; micro: Micro } {
  const tokens = mixedTokens(estimatePromptTokens(utf8Bytes), maxTokens);
  return { tokens, micro: charge(tokens, ask) };
}
