import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import type { RailId } from "./types";

export type ReserveInput = {
  keyId: string;
  listingId: string;
  rail: RailId;
  price: bigint;
  tokens: bigint;
  micro: bigint;
};

export type ReserveResult = { listingOk: boolean; keyOk: boolean; usageId: string | null };

type ReserveRow = { listing_ok: number; key_ok: number; usage_id: string | null };

export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  const result = await db().execute<ReserveRow>(sql`
    with l as (
      select id from listings
      where id = ${input.listingId}
        and status = 'active'
        and used_tokens + reserved_tokens + ${input.tokens} <= capacity_tokens
      for update
    ), k as (
      update keys
      set balance_usd_micro = balance_usd_micro - ${input.micro},
          reserved_usd_micro = reserved_usd_micro + ${input.micro}
      where id = ${input.keyId}
        and balance_usd_micro >= ${input.micro}
        and exists (select 1 from l)
      returning id
    ), li as (
      update listings
      set reserved_tokens = reserved_tokens + ${input.tokens}
      where id = (select id from l)
        and exists (select 1 from k)
      returning id
    ), u as (
      insert into usage (status, rail, key_id, listing_id, price_micro_per_mtok, reserved_tokens, reserved_usd_micro)
      select 'open', ${input.rail}, ${input.keyId}, li.id, ${input.price}, ${input.tokens}, ${input.micro}
      from li
      returning id
    )
    select (select count(*) from l)::int as listing_ok,
           (select count(*) from k)::int as key_ok,
           (select id from u) as usage_id
  `);
  const row = result.rows[0];
  if (!row) return { listingOk: false, keyOk: false, usageId: null };
  return { listingOk: row.listing_ok === 1, keyOk: row.key_ok === 1, usageId: row.usage_id };
}

export type SettleInput = {
  usageId: string;
  promptTokens: bigint;
  completionTokens: bigint;
  mixedTokens: bigint;
  listCostMicro: bigint;
  chargeMicro: bigint;
  sellerEarningMicro: bigint;
  upstreamRequestId: string | null;
};

export async function settle(input: SettleInput): Promise<void> {
  await db().execute(sql`
    with u as (
      update usage set
        status = 'settled',
        prompt_tokens = ${Number(input.promptTokens)},
        completion_tokens = ${Number(input.completionTokens)},
        mixed_tokens = ${input.mixedTokens},
        list_cost_usd_micro = ${input.listCostMicro},
        charge_usd_micro = ${input.chargeMicro},
        seller_earning_usd_micro = ${input.sellerEarningMicro},
        upstream_request_id = ${input.upstreamRequestId},
        settled_at = now()
      where id = ${input.usageId} and status = 'open'
      returning reserved_tokens, reserved_usd_micro, listing_id, key_id, charge_usd_micro
    ), l as (
      update listings set
        reserved_tokens = listings.reserved_tokens - u.reserved_tokens,
        used_tokens = least(
          listings.used_tokens + ${input.mixedTokens},
          listings.capacity_tokens - (listings.reserved_tokens - u.reserved_tokens)
        ),
        status = case
          when listings.status = 'active'
           and least(
             listings.used_tokens + ${input.mixedTokens},
             listings.capacity_tokens - (listings.reserved_tokens - u.reserved_tokens)
           ) = listings.capacity_tokens
          then 'exhausted'
          else listings.status
        end
      from u
      where listings.id = u.listing_id
      returning listings.id
    ), k as (
      update keys set
        reserved_usd_micro = keys.reserved_usd_micro - u.reserved_usd_micro,
        balance_usd_micro = greatest(keys.balance_usd_micro + u.reserved_usd_micro - u.charge_usd_micro, 0)
      from u
      where keys.id = u.key_id
      returning keys.id
    )
    select 1
  `);
}

export async function release(usageId: string): Promise<void> {
  await db().execute(sql`
    with u as (
      update usage set status = 'released', settled_at = now()
      where id = ${usageId} and status = 'open'
      returning reserved_tokens, reserved_usd_micro, listing_id, key_id
    ), l as (
      update listings set reserved_tokens = listings.reserved_tokens - u.reserved_tokens
      from u
      where listings.id = u.listing_id
      returning listings.id
    ), k as (
      update keys set
        reserved_usd_micro = keys.reserved_usd_micro - u.reserved_usd_micro,
        balance_usd_micro = keys.balance_usd_micro + u.reserved_usd_micro
      from u
      where keys.id = u.key_id
      returning keys.id
    )
    select 1
  `);
}
