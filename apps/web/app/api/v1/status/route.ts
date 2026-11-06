import { sql } from "drizzle-orm";
import { asks } from "../../../../lib/book.ts";
import { db } from "../../../../lib/db.ts";
import { MARKETS, readMarket } from "../../../../lib/perp.ts";
import type { VenueStatus } from "../../../../lib/types";

const STALE_S = 600;

export async function GET(): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const [markets, payouts, venue, open] = await Promise.all([
    Promise.all(
      MARKETS.map(async (model) => {
        const market = await readMarket(model).catch(() => null);
        const age = market && market.updatedAt > 0n ? now - Number(market.updatedAt) : null;
        return {
          model,
          index_micro_per_mtok: market && age !== null ? market.price.toString() : null,
          age_s: age,
          open: age !== null && age <= STALE_S,
        };
      }),
    ),
    db().execute<{ pending: number; scheduled: number; last_executed: string | null }>(sql`
      select count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'scheduled')::int as scheduled,
             max(day) filter (where status = 'executed')::text as last_executed
      from payouts
    `),
    db().execute<{ fills: number; volume: string }>(sql`
      select count(*)::int as fills, coalesce(sum(tokens), 0)::text as volume
      from trades where created_at > now() - interval '24 hours'
    `),
    asks(null),
  ]);

  const ages = markets.flatMap((market) => (market.age_s === null ? [] : [market.age_s]));
  const status: VenueStatus = {
    keeper_last_post_s: ages.length > 0 ? Math.min(...ages) : null,
    markets,
    payouts: {
      pending: payouts.rows[0]?.pending ?? 0,
      scheduled: payouts.rows[0]?.scheduled ?? 0,
      last_executed_day: payouts.rows[0]?.last_executed ?? null,
    },
    venue: { fills_24h: venue.rows[0]?.fills ?? 0, volume_24h_tokens: venue.rows[0]?.volume ?? "0", open_asks: open.length },
  };
  return Response.json(status, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" } });
}
