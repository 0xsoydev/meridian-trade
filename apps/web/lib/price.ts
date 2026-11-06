import type { UTCTimestamp } from "lightweight-charts";
import type { BookAsk, BookFill, Micro, MicroPerMTok, Pricing, Rail, RailId } from "./types";

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

export const TOPUP_MIN_MICRO = 100_000n;
export const TOPUP_MAX_MICRO = 20_000_000n;

export function parseUsd(decimal: string): Micro | null {
  const match = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(decimal.trim());
  if (!match) return null;
  return BigInt(match[1] ?? "0") * MICRO_PER_MTOK + BigInt((match[2] ?? "").padEnd(6, "0"));
}

export function formatMicroPerMtok(value: MicroPerMTok): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export const formatUsd = (micro: Micro): string => `$${formatMicroPerMtok(micro)}`;

export const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const stampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour12: false,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const group = (whole: bigint) => whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatMtok(tokens: bigint): string {
  const whole = tokens / MICRO_PER_MTOK;
  const fraction = ((tokens % MICRO_PER_MTOK) / 1_000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${group(whole)}.${fraction}` : group(whole);
}

export function parseMtok(input: string): bigint {
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/.exec(input.trim().replace(/[,_\s]/g, ""));
  if (!match) return 0n;
  return BigInt(match[1] ?? "0") * MICRO_PER_MTOK + BigInt((match[2] ?? "").padEnd(6, "0"));
}

export function blended(p: Pricing): MicroPerMTok {
  return (3n * p.prompt + p.completion) / 4n;
}

export function listCeiling(model: string, rails: ReadonlyArray<Rail>): MicroPerMTok | null {
  let ceiling: MicroPerMTok | null = null;
  for (const rail of rails) {
    if (!rail.enabled) continue;
    const match = rail.models.find((entry) => entry.canonical === model);
    if (!match) continue;
    const price = blended({ prompt: match.listPrompt, completion: match.listCompletion });
    if (ceiling === null || price > ceiling) ceiling = price;
  }
  return ceiling;
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

export type FillPreview = {
  fillable: bigint;
  cost: bigint;
  avg: bigint;
  fee: bigint;
  net: bigint;
  partial: boolean;
};

export function previewFill(
  asks: ReadonlyArray<Pick<BookAsk, "price_micro_per_mtok" | "tokens_left">>,
  wanted: bigint,
  takeBps: bigint,
): FillPreview {
  let left = wanted;
  let cost = 0n;
  let fillable = 0n;
  for (const ask of asks) {
    if (left === 0n) break;
    const price = BigInt(ask.price_micro_per_mtok);
    const depth = BigInt(ask.tokens_left);
    const take = depth < left ? depth : left;
    cost += charge(take, price);
    fillable += take;
    left -= take;
  }
  return {
    fillable,
    cost,
    avg: fillable === 0n ? 0n : (cost * 1_000_000n) / fillable,
    fee: cost - sellerEarning(cost, takeBps),
    net: sellerEarning(cost, takeBps),
    partial: fillable < wanted,
  };
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

export type ChartPoint = { time: UTCTimestamp; value: number; volume: number };

export type CandlePoint = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number };

export function fillsToPoints(fills: BookFill[], sinceMs = Number.NEGATIVE_INFINITY): ChartPoint[] {
  return fills
    .filter((fill) => Date.parse(fill.created_at) >= sinceMs)
    .reverse()
    .map((fill) => ({
      time: Math.floor(Date.parse(fill.created_at) / 1000) as UTCTimestamp,
      value: Number(fill.price_micro_per_mtok) / 1e6,
      volume: Number(fill.tokens) / 1e6,
    }));
}

export function candlesFromPoints(points: ChartPoint[], bucket: number): CandlePoint[] {
  const candles: CandlePoint[] = [];
  for (const point of points) {
    const time = (Math.floor(point.time / bucket) * bucket) as UTCTimestamp;
    const last = candles.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, point.value);
      last.low = Math.min(last.low, point.value);
      last.close = point.value;
      last.volume += point.volume;
    } else {
      const open = last?.close ?? point.value;
      candles.push({
        time,
        open,
        high: Math.max(open, point.value),
        low: Math.min(open, point.value),
        close: point.value,
        volume: point.volume,
      });
    }
  }
  return candles;
}
