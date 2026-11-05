import { and, asc, desc, eq, sql } from "drizzle-orm";
import { asks } from "./book.ts";
import { db } from "./db.ts";
import { nextUtcMidnight } from "./ledger.ts";
import { charge } from "./price.ts";
import { bids } from "./schema.ts";
import type { Bid } from "./types";

export async function restBid(keyId: string, model: string, price: bigint, tokens: bigint): Promise<Bid | null> {
  const hold = charge(tokens, price);
  const result = await db().execute<{ id: string; created_at: string }>(sql`
    with k as (
      update keys set balance_usd_micro = balance_usd_micro - ${hold}
      where id = ${keyId} and balance_usd_micro >= ${hold}
      returning id
    )
    insert into bids (key_id, model, price_micro_per_mtok, tokens, hold_usd_micro, status)
    select k.id, ${model}, ${price}, ${tokens}, ${hold}, 'open' from k
    returning id, created_at
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    bid_id: row.id,
    model,
    tokens: tokens.toString(),
    price_micro_per_mtok: price.toString(),
    hold_usd_micro: hold.toString(),
    created_at: new Date(row.created_at).toISOString(),
  };
}

async function fillBid(input: {
  bidId: string;
  listingId: string;
  model: string;
  take: bigint;
  takeBps: bigint;
  expiresAt: Date | null;
}): Promise<boolean> {
  const result = await db().execute<{ filled: number }>(sql`
    with b as (
      select id, key_id, price_micro_per_mtok as price,
        hold_usd_micro - ((tokens - ${input.take}) * price_micro_per_mtok + 999999) / 1000000 as charge
      from bids
      where id = ${input.bidId} and status = 'open' and tokens >= ${input.take}
      for update
    ), l as (
      select id from listings
      where id = ${input.listingId}
        and status = 'active'
        and (throttled_until is null or throttled_until < now())
        and used_tokens + reserved_tokens + ${input.take} <= capacity_tokens
        and exists (select 1 from b)
      for update
    ), bu as (
      update bids set
        tokens = tokens - ${input.take},
        hold_usd_micro = hold_usd_micro - (select charge from b),
        status = case when tokens = ${input.take} then 'filled' else status end
      where id = (select id from b) and exists (select 1 from l)
      returning id
    ), li as (
      update listings set
        used_tokens = used_tokens + ${input.take},
        status = case when used_tokens + ${input.take} = capacity_tokens then 'exhausted' else status end
      where id = (select id from l) and exists (select 1 from bu)
      returning id
    ), t as (
      insert into trades (key_id, listing_id, model, tokens, price_micro_per_mtok, charge_usd_micro, seller_earning_usd_micro)
      select b.key_id, li.id, ${input.model}, ${input.take}, b.price, b.charge, b.charge * ${10_000n - input.takeBps} / 10000
      from li, b
      returning id
    ), p as (
      insert into prepaid (key_id, listing_id, model, tokens_remaining, expires_at)
      select b.key_id, li.id, ${input.model}, ${input.take}, ${input.expiresAt ? input.expiresAt.toISOString() : null}
      from li, b
      returning id
    )
    select (select count(*) from li)::int as filled
  `);
  return result.rows[0]?.filled === 1;
}

export async function matchBids(model: string): Promise<number> {
  const takeBps = BigInt(process.env.TAKE_BPS ?? "1000");
  let filled = 0;
  for (;;) {
    const [bid] = await db()
      .select({ id: bids.id, price: bids.priceMicroPerMtok, tokens: bids.tokens })
      .from(bids)
      .where(and(eq(bids.model, model), eq(bids.status, "open")))
      .orderBy(desc(bids.priceMicroPerMtok), asc(bids.createdAt))
      .limit(1);
    const ask = bid ? (await asks(model))[0] : undefined;
    if (!bid || !ask || ask.price > bid.price) return filled;
    const matched = await fillBid({
      bidId: bid.id,
      listingId: ask.listingId,
      model,
      take: bid.tokens < ask.tokensLeft ? bid.tokens : ask.tokensLeft,
      takeBps,
      expiresAt: ask.rail.resetPeriod === "daily" ? nextUtcMidnight(new Date()) : null,
    });
    if (!matched) return filled;
    filled += 1;
  }
}

export async function matchAllBids(): Promise<number> {
  const open = await db().selectDistinct({ model: bids.model }).from(bids).where(eq(bids.status, "open"));
  let filled = 0;
  for (const { model } of open) filled += await matchBids(model);
  return filled;
}

export async function cancelBid(bidId: string, keyId: string): Promise<bigint | null> {
  const result = await db().execute<{ balance: string }>(sql`
    with b as (
      select id, hold_usd_micro from bids
      where id = ${bidId} and key_id = ${keyId} and status = 'open'
      for update
    ), c as (
      update bids set status = 'cancelled', hold_usd_micro = 0
      where id = (select id from b)
      returning id
    )
    update keys set balance_usd_micro = balance_usd_micro + (select hold_usd_micro from b)
    where id = ${keyId} and exists (select 1 from c)
    returning balance_usd_micro::text as balance
  `);
  const row = result.rows[0];
  return row ? BigInt(row.balance) : null;
}
