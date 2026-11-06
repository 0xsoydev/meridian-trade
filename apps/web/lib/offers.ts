import { and, asc, desc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { catalog } from "./rails.ts";
import { bids, listings, offers, prepaid, trades } from "./schema.ts";
import type { KeyFill, Offer, Rail, Verifiability } from "./types";

const SELLABLE = ["active", "exhausted", "cancelled"];

export type Held = {
  prepaidId: string;
  model: string;
  listingId: string;
  rail: string;
  tokens: bigint;
  expiresAt: Date | null;
};

export type OfferAsk = {
  offerId: string;
  listingId: string;
  rail: Rail;
  verifiability: Verifiability;
  price: bigint;
  tokensLeft: bigint;
  createdAt: Date;
};

function offerView(row: typeof offers.$inferSelect): Offer {
  return {
    offer_id: row.id,
    model: row.model,
    listing_id: row.listingId,
    tokens: row.tokens.toString(),
    price_micro_per_mtok: row.priceMicroPerMtok.toString(),
    expires_at: row.expiresAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

const unexpired = (column: typeof prepaid.expiresAt | typeof offers.expiresAt) => or(isNull(column), gt(column, new Date()));

export async function holdings(keyId: string, model: string | null): Promise<Held[]> {
  const rows = await db()
    .select({
      prepaidId: prepaid.id,
      model: prepaid.model,
      listingId: prepaid.listingId,
      rail: listings.rail,
      tokens: prepaid.tokensRemaining,
      expiresAt: prepaid.expiresAt,
    })
    .from(prepaid)
    .innerJoin(listings, eq(listings.id, prepaid.listingId))
    .where(
      and(
        eq(prepaid.keyId, keyId),
        model === null ? undefined : eq(prepaid.model, model),
        gt(prepaid.tokensRemaining, 0n),
        unexpired(prepaid.expiresAt),
        inArray(listings.status, SELLABLE),
      ),
    )
    .orderBy(sql`${prepaid.expiresAt} asc nulls last`, asc(prepaid.createdAt));
  return rows;
}

export async function offerAsks(model: string, excludeKeyId: string | null): Promise<OfferAsk[]> {
  const rails = new Map<string, Rail>((await catalog()).map((rail) => [rail.id, rail]));
  const rows = await db()
    .select({ offer: offers, rail: listings.rail })
    .from(offers)
    .innerJoin(listings, eq(listings.id, offers.listingId))
    .where(
      and(
        eq(offers.model, model),
        eq(offers.status, "open"),
        gt(offers.tokens, 0n),
        unexpired(offers.expiresAt),
        inArray(listings.status, SELLABLE),
        excludeKeyId === null ? undefined : ne(offers.keyId, excludeKeyId),
      ),
    )
    .orderBy(asc(offers.priceMicroPerMtok), asc(offers.createdAt));
  return rows.flatMap(({ offer, rail: railId }) => {
    const rail = rails.get(railId);
    if (!rail) return [];
    const entry = rail.models.find((candidate) => candidate.canonical === offer.model);
    return [
      {
        offerId: offer.id,
        listingId: offer.listingId,
        rail,
        verifiability: entry?.verifiability ?? null,
        price: offer.priceMicroPerMtok,
        tokensLeft: offer.tokens,
        createdAt: offer.createdAt,
      },
    ];
  });
}

export async function bestBid(model: string, sellerKeyId: string, floor: bigint | null) {
  const [bid] = await db()
    .select({ id: bids.id, price: bids.priceMicroPerMtok, tokens: bids.tokens })
    .from(bids)
    .where(
      and(
        eq(bids.model, model),
        eq(bids.status, "open"),
        gt(bids.tokens, 0n),
        ne(bids.keyId, sellerKeyId),
        floor === null ? undefined : gte(bids.priceMicroPerMtok, floor),
      ),
    )
    .orderBy(desc(bids.priceMicroPerMtok), asc(bids.createdAt))
    .limit(1);
  return bid ?? null;
}

export async function sellIntoBid(input: {
  bidId: string;
  prepaidId: string;
  sellerKeyId: string;
  take: bigint;
  takeBps: bigint;
}): Promise<{ charge: bigint } | null> {
  const result = await db().execute<{ filled: number; charge: string | null }>(sql`
    with b as (
      select id, key_id, model, price_micro_per_mtok as price,
        hold_usd_micro - ((tokens - ${input.take}) * price_micro_per_mtok + 999999) / 1000000 as charge
      from bids
      where id = ${input.bidId} and status = 'open' and tokens >= ${input.take} and key_id <> ${input.sellerKeyId}
      for update
    ), p as (
      select prepaid.id, prepaid.listing_id, prepaid.expires_at from prepaid
      where prepaid.id = ${input.prepaidId}
        and prepaid.key_id = ${input.sellerKeyId}
        and prepaid.model = (select model from b)
        and prepaid.tokens_remaining >= ${input.take}
        and (prepaid.expires_at is null or prepaid.expires_at > now())
        and exists (select 1 from listings where listings.id = prepaid.listing_id and listings.status in ('active', 'exhausted', 'cancelled'))
      for update
    ), bu as (
      update bids set
        tokens = tokens - ${input.take},
        hold_usd_micro = hold_usd_micro - (select charge from b),
        status = case when tokens = ${input.take} then 'filled' else status end
      where id = (select id from b) and exists (select 1 from p)
      returning id
    ), pu as (
      update prepaid set tokens_remaining = tokens_remaining - ${input.take}
      where id = (select id from p) and exists (select 1 from bu)
      returning id
    ), k as (
      update keys set balance_usd_micro = balance_usd_micro + (select charge from b) * ${10_000n - input.takeBps} / 10000
      where id = ${input.sellerKeyId} and exists (select 1 from pu)
      returning id
    ), t as (
      insert into trades (key_id, listing_id, model, tokens, price_micro_per_mtok, charge_usd_micro, seller_earning_usd_micro, seller_key_id)
      select b.key_id, p.listing_id, b.model, ${input.take}, b.price, b.charge, b.charge * ${10_000n - input.takeBps} / 10000, ${input.sellerKeyId}::uuid
      from b, p
      where exists (select 1 from k)
      returning id
    ), np as (
      insert into prepaid (key_id, listing_id, model, tokens_remaining, expires_at)
      select b.key_id, p.listing_id, b.model, ${input.take}, p.expires_at
      from b, p
      where exists (select 1 from k)
      returning id
    )
    select (select count(*) from k)::int as filled, (select charge from b)::text as charge
  `);
  const row = result.rows[0];
  return row?.filled === 1 && row.charge !== null ? { charge: BigInt(row.charge) } : null;
}

export async function escrowOffer(input: { keyId: string; prepaidId: string; tokens: bigint; price: bigint }): Promise<Offer | null> {
  const result = await db().execute<{ id: string }>(sql`
    with p as (
      select prepaid.id, prepaid.listing_id, prepaid.model, prepaid.expires_at from prepaid
      where prepaid.id = ${input.prepaidId}
        and prepaid.key_id = ${input.keyId}
        and prepaid.tokens_remaining >= ${input.tokens}
        and (prepaid.expires_at is null or prepaid.expires_at > now())
        and exists (select 1 from listings where listings.id = prepaid.listing_id and listings.status in ('active', 'exhausted', 'cancelled'))
      for update
    ), pu as (
      update prepaid set tokens_remaining = tokens_remaining - ${input.tokens}
      where id = (select id from p)
      returning id
    )
    insert into offers (key_id, prepaid_id, listing_id, model, price_micro_per_mtok, tokens, expires_at, status)
    select ${input.keyId}::uuid, p.id, p.listing_id, p.model, ${input.price}, ${input.tokens}, p.expires_at, 'open'
    from p
    where exists (select 1 from pu)
    returning id
  `);
  const id = result.rows[0]?.id;
  if (!id) return null;
  const [row] = await db().select().from(offers).where(eq(offers.id, id)).limit(1);
  return row ? offerView(row) : null;
}

export async function buyOffer(input: {
  offerId: string;
  buyerKeyId: string;
  take: bigint;
  takeBps: bigint;
}): Promise<{ offerOk: boolean; keyOk: boolean }> {
  const result = await db().execute<{ offer_ok: number; key_ok: number }>(sql`
    with o as (
      select id, key_id, listing_id, model, price_micro_per_mtok as price, expires_at,
        (${input.take} * price_micro_per_mtok + 999999) / 1000000 as charge
      from offers
      where id = ${input.offerId}
        and status = 'open'
        and tokens >= ${input.take}
        and key_id <> ${input.buyerKeyId}
        and (expires_at is null or expires_at > now())
      for update
    ), k as (
      update keys set balance_usd_micro = balance_usd_micro - (select charge from o)
      where id = ${input.buyerKeyId} and balance_usd_micro >= (select charge from o) and exists (select 1 from o)
      returning id
    ), ou as (
      update offers set
        tokens = tokens - ${input.take},
        status = case when tokens = ${input.take} then 'filled' else status end
      where id = (select id from o) and exists (select 1 from k)
      returning id
    ), s as (
      update keys set balance_usd_micro = balance_usd_micro + (select charge from o) * ${10_000n - input.takeBps} / 10000
      where id = (select key_id from o) and exists (select 1 from ou)
      returning id
    ), t as (
      insert into trades (key_id, listing_id, model, tokens, price_micro_per_mtok, charge_usd_micro, seller_earning_usd_micro, seller_key_id)
      select ${input.buyerKeyId}::uuid, o.listing_id, o.model, ${input.take}, o.price, o.charge, o.charge * ${10_000n - input.takeBps} / 10000, o.key_id
      from o
      where exists (select 1 from s)
      returning id
    ), np as (
      insert into prepaid (key_id, listing_id, model, tokens_remaining, expires_at)
      select ${input.buyerKeyId}::uuid, o.listing_id, o.model, ${input.take}, o.expires_at
      from o
      where exists (select 1 from s)
      returning id
    )
    select (select count(*) from o)::int as offer_ok, (select count(*) from s)::int as key_ok
  `);
  const row = result.rows[0];
  return { offerOk: row?.offer_ok === 1, keyOk: row?.key_ok === 1 };
}

export async function cancelOffer(offerId: string, keyId: string): Promise<boolean> {
  const result = await db().execute<{ id: string }>(sql`
    with o as (
      select id, prepaid_id, tokens from offers
      where id = ${offerId} and key_id = ${keyId} and status = 'open'
      for update
    ), c as (
      update offers set status = 'cancelled', tokens = 0
      where id = (select id from o)
      returning id
    )
    update prepaid set tokens_remaining = tokens_remaining + (select tokens from o)
    where id = (select prepaid_id from o) and exists (select 1 from c)
    returning prepaid.id
  `);
  return result.rows.length === 1;
}

export async function openOffers(keyId: string, model: string | null): Promise<Offer[]> {
  const rows = await db()
    .select()
    .from(offers)
    .where(
      and(
        eq(offers.keyId, keyId),
        eq(offers.status, "open"),
        gt(offers.tokens, 0n),
        unexpired(offers.expiresAt),
        model === null ? undefined : eq(offers.model, model),
      ),
    )
    .orderBy(desc(offers.createdAt))
    .limit(100);
  return rows.map(offerView);
}

export async function keyFills(keyId: string): Promise<KeyFill[]> {
  const rows = await db()
    .select()
    .from(trades)
    .where(or(eq(trades.keyId, keyId), eq(trades.sellerKeyId, keyId)))
    .orderBy(desc(trades.createdAt))
    .limit(100);
  return rows.map((row) => {
    const sold = row.sellerKeyId === keyId;
    return {
      at: row.createdAt.toISOString(),
      model: row.model,
      side: sold ? "sell" : "buy",
      tokens: row.tokens.toString(),
      price_micro_per_mtok: row.priceMicroPerMtok.toString(),
      amount_usd_micro: (sold ? row.sellerEarningUsdMicro : row.chargeUsdMicro).toString(),
    };
  });
}
