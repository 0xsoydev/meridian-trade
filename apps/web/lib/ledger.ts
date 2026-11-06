import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { walletOf } from "./accounts.ts";
import { hashKey } from "./auth.ts";
import { db } from "./db.ts";
import { evmAddressOf, treasuryEvm } from "./mirror.ts";
import { keys, usage } from "./schema.ts";
import type { Balance, RailId } from "./types";

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

export type PrepaidReserveInput = { keyId: string; prepaidId: string; rail: RailId; tokens: bigint };

export async function reservePrepaid(input: PrepaidReserveInput): Promise<string | null> {
  const result = await db().execute<{ usage_id: string | null }>(sql`
    with p as (
      update prepaid
      set tokens_remaining = tokens_remaining - ${input.tokens}
      where id = ${input.prepaidId}
        and key_id = ${input.keyId}
        and tokens_remaining >= ${input.tokens}
        and (expires_at is null or expires_at > now())
      returning id, listing_id
    ), u as (
      insert into usage (status, rail, key_id, listing_id, prepaid_id, price_micro_per_mtok, reserved_tokens, reserved_usd_micro)
      select 'open', ${input.rail}, ${input.keyId}, p.listing_id, p.id, 0, ${input.tokens}, 0
      from p
      returning id
    )
    select (select id from u) as usage_id
  `);
  return result.rows[0]?.usage_id ?? null;
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
        charge_usd_micro = case when usage.prepaid_id is null then ${input.chargeMicro}::bigint else 0 end,
        seller_earning_usd_micro = case when usage.prepaid_id is null then ${input.sellerEarningMicro}::bigint else 0 end,
        upstream_request_id = ${input.upstreamRequestId},
        settled_at = now()
      where id = ${input.usageId} and status = 'open'
      returning reserved_tokens, reserved_usd_micro, listing_id, key_id, prepaid_id, charge_usd_micro
    ), p as (
      update prepaid set
        tokens_remaining = greatest(prepaid.tokens_remaining + u.reserved_tokens - ${input.mixedTokens}::bigint, 0)
      from u
      where prepaid.id = u.prepaid_id
      returning prepaid.id
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
      where u.prepaid_id is null and listings.id = u.listing_id
      returning listings.id
    ), k as (
      update keys set
        reserved_usd_micro = keys.reserved_usd_micro - u.reserved_usd_micro,
        balance_usd_micro = greatest(keys.balance_usd_micro + u.reserved_usd_micro - u.charge_usd_micro, 0)
      from u
      where u.prepaid_id is null and keys.id = u.key_id
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
      returning reserved_tokens, reserved_usd_micro, listing_id, key_id, prepaid_id
    ), p as (
      update prepaid set tokens_remaining = prepaid.tokens_remaining + u.reserved_tokens
      from u
      where prepaid.id = u.prepaid_id
      returning prepaid.id
    ), l as (
      update listings set reserved_tokens = listings.reserved_tokens - u.reserved_tokens
      from u
      where u.prepaid_id is null and listings.id = u.listing_id
      returning listings.id
    ), k as (
      update keys set
        reserved_usd_micro = keys.reserved_usd_micro - u.reserved_usd_micro,
        balance_usd_micro = keys.balance_usd_micro + u.reserved_usd_micro
      from u
      where u.prepaid_id is null and keys.id = u.key_id
      returning keys.id
    )
    select 1
  `);
}

export async function releaseStale(olderThanMs = 360_000): Promise<number> {
  const stale = await db()
    .select({ id: usage.id })
    .from(usage)
    .where(and(eq(usage.status, "open"), lt(usage.createdAt, new Date(Date.now() - olderThanMs))));
  for (const row of stale) await release(row.id);
  return stale.length;
}

export type FillInput = {
  keyId: string;
  listingId: string;
  model: string;
  tokens: bigint;
  price: bigint;
  chargeMicro: bigint;
  sellerEarningMicro: bigint;
  expiresAt: Date | null;
};

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export async function fill(input: FillInput): Promise<{ listingOk: boolean; keyOk: boolean }> {
  const result = await db().execute<{ listing_ok: number; key_ok: number }>(sql`
    with l as (
      select id from listings
      where id = ${input.listingId}
        and status = 'active'
        and (throttled_until is null or throttled_until < now())
        and used_tokens + reserved_tokens + ${input.tokens} <= capacity_tokens
      for update
    ), k as (
      update keys
      set balance_usd_micro = balance_usd_micro - ${input.chargeMicro}
      where id = ${input.keyId}
        and balance_usd_micro >= ${input.chargeMicro}
        and exists (select 1 from l)
      returning id
    ), li as (
      update listings set
        used_tokens = used_tokens + ${input.tokens},
        status = case when used_tokens + ${input.tokens} = capacity_tokens then 'exhausted' else status end
      where id = (select id from l)
        and exists (select 1 from k)
      returning id
    ), t as (
      insert into trades (key_id, listing_id, model, tokens, price_micro_per_mtok, charge_usd_micro, seller_earning_usd_micro)
      select ${input.keyId}, li.id, ${input.model}, ${input.tokens}, ${input.price}, ${input.chargeMicro}, ${input.sellerEarningMicro}
      from li
      returning id
    ), p as (
      insert into prepaid (key_id, listing_id, model, tokens_remaining, expires_at)
      select ${input.keyId}, li.id, ${input.model}, ${input.tokens}, ${input.expiresAt ? input.expiresAt.toISOString() : null}
      from li
      returning id
    )
    select (select count(*) from l)::int as listing_ok,
           (select count(*) from k)::int as key_ok
  `);
  const row = result.rows[0];
  return { listingOk: row?.listing_ok === 1, keyOk: row?.key_ok === 1 };
}

export async function prepaidHolding(keyId: string, model: string): Promise<bigint> {
  const result = await db().execute<{ total: string }>(sql`
    select coalesce(sum(tokens_remaining), 0)::text as total
    from prepaid
    where key_id = ${keyId} and model = ${model} and (expires_at is null or expires_at > now())
  `);
  return BigInt(result.rows[0]?.total ?? "0");
}

export type Payment = { txId: string; amountMicro: bigint; payer: string };

export async function credit(keyId: string, payment: Payment): Promise<bigint | null> {
  const result = await db().execute<{ balance_usd_micro: string }>(sql`
    with t as (
      insert into topups (tx_id, key_id, amount_usd_micro, payer)
      values (${payment.txId}, ${keyId}, ${payment.amountMicro}, ${payment.payer})
      on conflict (tx_id) do nothing
      returning amount_usd_micro
    )
    update keys set balance_usd_micro = keys.balance_usd_micro + t.amount_usd_micro
    from t
    where keys.id = ${keyId}
    returning keys.balance_usd_micro::text
  `);
  const row = result.rows[0];
  return row ? BigInt(row.balance_usd_micro) : null;
}

export async function createFundedKey(payment: Payment): Promise<{ keyId: string; rawKey: string; balance: bigint } | null> {
  const rawKey = `rk_${randomBytes(32).toString("base64url")}`;
  const keyId = randomUUID();
  const result = await db().execute<{ balance_usd_micro: string }>(sql`
    with t as (
      insert into topups (tx_id, key_id, amount_usd_micro, payer)
      values (${payment.txId}, ${keyId}, ${payment.amountMicro}, ${payment.payer})
      on conflict (tx_id) do nothing
      returning amount_usd_micro
    )
    insert into keys (id, hash, balance_usd_micro)
    select ${keyId}, decode(${hashKey(rawKey).toString("hex")}, 'hex'), t.amount_usd_micro
    from t
    returning balance_usd_micro::text
  `);
  const row = result.rows[0];
  return row ? { keyId, rawKey, balance: BigInt(row.balance_usd_micro) } : null;
}

export async function toppedUpToday(keyId: string): Promise<bigint> {
  const result = await db().execute<{ total: string }>(sql`
    select coalesce(sum(amount_usd_micro), 0)::text as total
    from topups
    where key_id = ${keyId} and created_at >= date_trunc('day', now(), 'UTC')
  `);
  return BigInt(result.rows[0]?.total ?? "0");
}

export async function balanceOf(keyId: string): Promise<Balance | null> {
  const row = (await db().select().from(keys).where(eq(keys.id, keyId)).limit(1))[0];
  if (!row) return null;
  return {
    memo: keyId,
    treasury: process.env.HEDERA_TREASURY_ID ?? null,
    treasury_evm: await treasuryEvm().catch(() => null),
    usdc_evm: evmAddressOf(process.env.HEDERA_USDC ?? "0.0.429274"),
    wallet: await walletOf(row.accountId),
    balance_usd_micro: row.balanceUsdMicro.toString(),
    reserved_usd_micro: row.reservedUsdMicro.toString(),
    topped_up_today_usd_micro: (await toppedUpToday(keyId)).toString(),
    daily_topup_cap_usd_micro: row.dailyTopupCapUsdMicro.toString(),
    auto_topup_usd_micro: row.autoTopupUsdMicro.toString(),
    default_model: row.defaultModel,
    human_linked: row.worldSub !== null,
  };
}
