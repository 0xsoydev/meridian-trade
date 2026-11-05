import { blended } from "./price.ts";
import type { Pricing } from "./types";

const MTOK = 1_000_000n;
const MAX_INT8 = 9_223_372_036_854_775_807n;

export function parseCapacityMtok(value: string): bigint | null {
  if (!/^\d{1,18}$/.test(value)) return null;
  const tokens = BigInt(value) * MTOK;
  return tokens > 0n && tokens <= MAX_INT8 ? tokens : null;
}

export function listingPriceError(
  price: bigint | null,
  own: Pricing,
  resetPeriod: "daily" | "monthly" | null,
): string | null {
  if (price === null) {
    return resetPeriod === null ? "a blank price requires expiring credits" : null;
  }
  if (price <= 0n) return "price must be positive";
  return price <= blended(own) ? null : "price must be at or below this rail's list price";
}
