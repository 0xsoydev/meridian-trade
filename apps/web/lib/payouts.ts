import {
  AccountId,
  ReceiptStatusError,
  ScheduleCreateTransaction,
  Status,
  Timestamp,
  TokenId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.ts";
import { hederaClient } from "./hcs.ts";
import { catalog } from "./rails.ts";
import { listings, payouts, sellers } from "./schema.ts";

const DAY_MS = 86_400_000;
const LATE_PAYOUT_MS = 10 * 60_000;

const accountSchema = z.object({ account: z.string().regex(/^\d+\.\d+\.\d+$/) });
const scheduleSchema = z.object({ executed_timestamp: z.string().nullable(), deleted: z.boolean() });
const transactionsSchema = z.object({ transactions: z.array(z.object({ result: z.string(), scheduled: z.boolean() })) });

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function payAt(day: string): Date {
  return new Date(Date.parse(`${day}T01:00:00.000Z`) + DAY_MS);
}

export function scheduleExpiry(day: string, nowMs: number): Date {
  return new Date(Math.max(payAt(day).getTime(), nowMs + LATE_PAYOUT_MS));
}

export async function scheduleSlot(payoutId: string, day: string, nowMs: number): Promise<Date | null> {
  const [row] = await db()
    .update(payouts)
    .set({ executeAt: sql`coalesce(${payouts.executeAt}, ${scheduleExpiry(day, nowMs).toISOString()}::timestamptz)` })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, "pending")))
    .returning({ executeAt: payouts.executeAt });
  return row?.executeAt ?? null;
}

function mirrorUrl(path: string): URL {
  return new URL(path, process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com");
}

export async function mirrorAccount(evmAddress: string): Promise<string | null> {
  const response = await fetch(mirrorUrl(`/api/v1/accounts/${evmAddress}`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`mirror returned ${response.status} for ${evmAddress}`);
  return accountSchema.parse(await response.json()).account;
}

export async function scheduleState(scheduleId: string): Promise<"executed" | "failed" | "cancelled" | "waiting"> {
  const response = await fetch(mirrorUrl(`/api/v1/schedules/${scheduleId}`));
  if (response.status === 404) return "waiting";
  if (!response.ok) throw new Error(`mirror returned ${response.status} for schedule ${scheduleId}`);
  const schedule = scheduleSchema.parse(await response.json());
  if (!schedule.executed_timestamp) return schedule.deleted ? "cancelled" : "waiting";
  const executed = await fetch(mirrorUrl(`/api/v1/transactions?timestamp=${schedule.executed_timestamp}`));
  if (!executed.ok) throw new Error(`mirror returned ${executed.status} for schedule ${scheduleId} execution`);
  const { transactions } = transactionsSchema.parse(await executed.json());
  return transactions.some((t) => t.scheduled && t.result === "SUCCESS") ? "executed" : "failed";
}

export async function closeDay(day: string): Promise<number> {
  const cutoff = new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString();
  const result = await db().execute<{ created: string }>(sql`
    with u as (
      select usage.id, listings.seller_id, usage.seller_earning_usd_micro as amount
      from usage join listings on listings.id = usage.listing_id
      where usage.status = 'settled' and usage.payout_id is null
        and usage.seller_earning_usd_micro > 0 and usage.settled_at < ${cutoff}::timestamptz
    ), t as (
      select trades.id, listings.seller_id, trades.seller_earning_usd_micro as amount
      from trades join listings on listings.id = trades.listing_id
      where trades.payout_id is null and trades.seller_key_id is null
        and trades.seller_earning_usd_micro > 0 and trades.created_at < ${cutoff}::timestamptz
    ), totals as (
      select seller_id, sum(amount)::bigint as amount
      from (select seller_id, amount from u union all select seller_id, amount from t) earned
      group by seller_id
    ), p as (
      insert into payouts (seller_id, day, amount_usd_micro, status)
      select seller_id, ${day}::date, amount, 'pending' from totals
      on conflict (seller_id, day) do nothing
      returning id, seller_id
    ), linked_usage as (
      update usage set payout_id = p.id
      from u join p on p.seller_id = u.seller_id
      where usage.id = u.id
      returning usage.id
    ), linked_trades as (
      update trades set payout_id = p.id
      from t join p on p.seller_id = t.seller_id
      where trades.id = t.id
      returning trades.id
    )
    select count(*)::text as created from p
  `);
  return Number(result.rows[0]?.created ?? "0");
}

async function ensureAccount(sellerId: string, evmAddress: string): Promise<string> {
  let account = await mirrorAccount(evmAddress);
  if (!account) {
    const client = hederaClient();
    const treasury = client.operatorAccountId;
    if (!treasury) throw new Error("Hedera operator is not set");
    const usdc = TokenId.fromString(process.env.HEDERA_USDC ?? "0.0.429274");
    const response = await new TransferTransaction()
      .addTokenTransfer(usdc, treasury, -1n)
      .addTokenTransfer(usdc, AccountId.fromEvmAddress(0, 0, evmAddress), 1n)
      .execute(client);
    await response.getReceipt(client);
    for (let attempt = 0; attempt < 10 && !account; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      account = await mirrorAccount(evmAddress);
    }
  }
  if (!account) throw new Error(`no Hedera account appeared for ${evmAddress}`);
  await db()
    .update(sellers)
    .set({ hederaAccount: account })
    .where(and(eq(sellers.id, sellerId), isNull(sellers.hederaAccount)));
  return account;
}

async function schedulePayout(payoutId: string, expiresAt: Date, amount: bigint, account: string): Promise<string> {
  const client = hederaClient();
  const treasury = client.operatorAccountId;
  const adminKey = client.operatorPublicKey;
  if (!treasury || !adminKey) throw new Error("Hedera operator is not set");
  const usdc = TokenId.fromString(process.env.HEDERA_USDC ?? "0.0.429274");
  const transaction = new ScheduleCreateTransaction()
    .setScheduledTransaction(
      new TransferTransaction().addTokenTransfer(usdc, treasury, -amount).addTokenTransfer(usdc, account, amount),
    )
    .setExpirationTime(Timestamp.fromDate(expiresAt))
    .setWaitForExpiry(true)
    .setAdminKey(adminKey)
    .setScheduleMemo(payoutId);
  try {
    const receipt = await (await transaction.execute(client)).getReceipt(client);
    if (!receipt.scheduleId) throw new Error(`no schedule id for payout ${payoutId}`);
    return receipt.scheduleId.toString();
  } catch (error) {
    if (error instanceof ReceiptStatusError && error.status === Status.IdenticalScheduleAlreadyCreated && error.transactionReceipt.scheduleId) return error.transactionReceipt.scheduleId.toString();
    throw error;
  }
}

export async function payPending(): Promise<string[]> {
  const lines: string[] = [];
  const rows = await db()
    .select({
      id: payouts.id,
      day: payouts.day,
      amount: payouts.amountUsdMicro,
      sellerId: sellers.id,
      address: sellers.address,
      hederaAccount: sellers.hederaAccount,
    })
    .from(payouts)
    .innerJoin(sellers, eq(sellers.id, payouts.sellerId))
    .where(eq(payouts.status, "pending"));
  for (const row of rows) {
    try {
      const account = row.hederaAccount ?? (await ensureAccount(row.sellerId, row.address));
      const expiresAt = await scheduleSlot(row.id, row.day, Date.now());
      if (!expiresAt) continue;
      if (expiresAt.getTime() <= Date.now()) {
        lines.push(`[payout] ${row.id}: still pending after its ${expiresAt.toISOString()} slot, needs an operator`);
        continue;
      }
      const scheduleId = await schedulePayout(row.id, expiresAt, row.amount, account);
      await db()
        .update(payouts)
        .set({ scheduleId, status: "scheduled" })
        .where(and(eq(payouts.id, row.id), eq(payouts.status, "pending")));
      lines.push(`[payout] ${row.id}: ${row.amount} micro-USDC to ${account}, schedule ${scheduleId}, executes ${expiresAt.toISOString()}`);
    } catch (error) {
      lines.push(`[payout] ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return lines;
}

export async function checkScheduled(): Promise<string[]> {
  const lines: string[] = [];
  const rows = await db()
    .select({ id: payouts.id, scheduleId: payouts.scheduleId })
    .from(payouts)
    .where(eq(payouts.status, "scheduled"));
  for (const row of rows) {
    if (!row.scheduleId) continue;
    const state = await scheduleState(row.scheduleId).catch((error: unknown): "waiting" => {
      lines.push(`[payout] ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      return "waiting";
    });
    if (state === "waiting") continue;
    if (state === "failed") {
      lines.push(`[payout] ${row.id}: schedule ${row.scheduleId} ran but the transfer failed, needs an operator`);
      continue;
    }
    await db()
      .update(payouts)
      .set({ status: state })
      .where(and(eq(payouts.id, row.id), eq(payouts.status, "scheduled")));
    lines.push(`[payout] ${row.id}: schedule ${row.scheduleId} ${state}`);
  }
  return lines;
}

export async function resetDailyListings(today: string): Promise<number> {
  const daily = (await catalog()).filter((rail) => rail.resetPeriod === "daily").map((rail) => rail.id);
  if (daily.length === 0) return 0;
  const reset = await db()
    .update(listings)
    .set({ usedTokens: 0n, status: "active", resetOn: today })
    .where(
      and(
        inArray(listings.rail, daily),
        inArray(listings.status, ["active", "exhausted"]),
        lt(listings.resetOn, today),
      ),
    )
    .returning({ id: listings.id });
  return reset.length;
}
