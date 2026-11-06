import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "./db.ts";
import { marketPrice, referenceFor } from "./price.ts";
import { catalog } from "./rails.ts";
import { listings } from "./schema.ts";
import type { Pricing, Rail, Verifiability } from "./types";

export type Ask = {
  listingId: string;
  model: string;
  upstream: string;
  rail: Rail;
  pricing: Pricing;
  verifiability: Verifiability;
  credential: string;
  price: bigint;
  tokensLeft: bigint;
  createdAt: Date;
};

export function byCheapest(sorted: ReadonlyArray<Pick<Ask, "model">>, models: ReadonlyArray<string>): string[] {
  const ranked = [...new Set(sorted.map((ask) => ask.model).filter((model) => models.includes(model)))];
  return [...ranked, ...models.filter((model) => !ranked.includes(model))];
}

export async function asks(model: string | null): Promise<Ask[]> {
  const rails = await catalog();
  const railById = new Map<string, Rail>(rails.map((rail) => [rail.id, rail]));
  const rows = await db()
    .select()
    .from(listings)
    .where(
      and(
        model === null ? undefined : eq(listings.model, model),
        eq(listings.status, "active"),
        or(isNull(listings.throttledUntil), lt(listings.throttledUntil, new Date())),
      ),
    );

  const bestLimit = new Map<string, bigint>();
  for (const row of rows) {
    if (row.priceMicroPerMtok === null || row.capacityTokens - row.usedTokens - row.reservedTokens <= 0n) continue;
    const best = bestLimit.get(row.model);
    if (best === undefined || row.priceMicroPerMtok < best) bestLimit.set(row.model, row.priceMicroPerMtok);
  }

  const result: Ask[] = [];
  for (const row of rows) {
    const rail = railById.get(row.rail);
    const entry = rail?.models.find((candidate) => candidate.canonical === row.model);
    const ref = referenceFor(row.model, rails);
    if (!rail || !entry || !ref) continue;
    const price = row.priceMicroPerMtok ?? marketPrice(bestLimit.get(row.model) ?? null, ref.pricing, rail);
    const tokensLeft = row.capacityTokens - row.usedTokens - row.reservedTokens;
    if (price === null || tokensLeft <= 0n) continue;
    result.push({
      listingId: row.id,
      model: row.model,
      upstream: entry.upstream,
      rail,
      pricing: { prompt: entry.listPrompt, completion: entry.listCompletion },
      verifiability: entry.verifiability,
      credential: row.credentialCiphertext,
      price,
      tokensLeft,
      createdAt: row.createdAt,
    });
  }
  return result.sort((a, b) =>
    a.price === b.price ? a.createdAt.getTime() - b.createdAt.getTime() : a.price < b.price ? -1 : 1,
  );
}
