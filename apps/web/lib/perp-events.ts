import { asc, eq, sql } from "drizzle-orm";
import { isAddress, type Address } from "viem";
import { indexOracleAbi, perpMarketAbi } from "./abi.ts";
import { addresses, publicClient } from "./chain.ts";
import { db } from "./db.ts";
import { LOG_CHUNK, MARKETS, marketId } from "./perp.ts";
import { perpEvents } from "./schema.ts";
import type { PerpFill } from "./types";

export type PerpEventRow = typeof perpEvents.$inferSelect;
export type ChainPerpEvent = PerpEventRow & { account: Address };

const HISTORY_LIMIT = 100;
const models = new Map<string, string>(MARKETS.map((model) => [marketId(model), model]));

export async function readPerpEvents(fromBlock: bigint, toBlock: bigint): Promise<ChainPerpEvent[]> {
  const client = publicClient();
  const { perpMarket, indexOracle } = addresses();
  const logs = await client.getContractEvents({ address: perpMarket, abi: perpMarketAbi, fromBlock, toBlock, strict: true });
  const stamps = new Map<bigint, Date>();
  const at = async (blockNumber: bigint): Promise<Date> => {
    const known = stamps.get(blockNumber);
    if (known) return known;
    const stamp = new Date(Number((await client.getBlock({ blockNumber })).timestamp) * 1000);
    stamps.set(blockNumber, stamp);
    return stamp;
  };

  const rows: ChainPerpEvent[] = [];
  for (const log of logs) {
    if (log.eventName !== "PositionModified" && log.eventName !== "Liquidated") continue;
    const model = models.get(log.args.market);
    const account = log.args.account.toLowerCase();
    if (!model || !isAddress(account)) continue;
    const base = {
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      account,
      model,
      block: log.blockNumber,
      at: await at(log.blockNumber),
    };
    if (log.eventName === "PositionModified") {
      rows.push({
        ...base,
        kind: "modify",
        size: log.args.size,
        margin: log.args.margin,
        price: log.args.price,
        realizedPnl: log.args.realizedPnl,
        fee: log.args.fee,
        reward: 0n,
      });
      continue;
    }
    const posted = await client.getContractEvents({
      address: indexOracle,
      abi: indexOracleAbi,
      eventName: "IndexPosted",
      args: { market: log.args.market },
      fromBlock: log.blockNumber > LOG_CHUNK ? log.blockNumber - LOG_CHUNK : 0n,
      toBlock: log.blockNumber,
      strict: true,
    });
    const price = posted.filter((p) => p.blockNumber < log.blockNumber || p.logIndex < log.logIndex).at(-1);
    rows.push({
      ...base,
      kind: "liquidate",
      size: 0n,
      margin: 0n,
      price: price?.args.priceMicroPerMTok ?? 0n,
      realizedPnl: 0n,
      fee: 0n,
      reward: log.args.reward,
    });
  }
  return rows;
}

export async function recordPerpEvents(rows: ReadonlyArray<PerpEventRow>): Promise<void> {
  if (rows.length === 0) return;
  await db().insert(perpEvents).values([...rows]).onConflictDoNothing();
}

export async function recordedPerps(): Promise<{ lastBlock: bigint | null; positions: { account: Address; model: string }[] }> {
  const [last] = await db()
    .select({ block: sql<string | null>`max(${perpEvents.block})::text` })
    .from(perpEvents);
  const rows = await db().selectDistinct({ account: perpEvents.account, model: perpEvents.model }).from(perpEvents);
  return {
    lastBlock: last?.block ? BigInt(last.block) : null,
    positions: rows.flatMap((row) => (isAddress(row.account) ? [{ account: row.account, model: row.model }] : [])),
  };
}

export function perpFills(rows: ReadonlyArray<PerpEventRow>): PerpFill[] {
  const open = new Map<string, { size: bigint; margin: bigint }>();
  return rows.map((row) => {
    const before = open.get(row.model) ?? { size: 0n, margin: 0n };
    const liquidated = row.kind === "liquidate";
    const after = liquidated ? 0n : row.size;
    open.set(row.model, { size: after, margin: liquidated ? 0n : row.margin });
    return {
      tx_hash: row.txHash,
      at: row.at.toISOString(),
      model: row.model,
      kind: liquidated ? "liquidate" : "modify",
      size_change: (after - before.size).toString(),
      size_after: after.toString(),
      price_micro_per_mtok: row.price.toString(),
      realized_pnl_usd_micro: (liquidated ? -before.margin : row.realizedPnl).toString(),
      fee_usd_micro: row.fee.toString(),
      reward_usd_micro: row.reward.toString(),
    };
  });
}

export async function perpHistory(account: string): Promise<PerpFill[]> {
  const rows = await db()
    .select()
    .from(perpEvents)
    .where(eq(perpEvents.account, account.toLowerCase()))
    .orderBy(asc(perpEvents.block), asc(perpEvents.logIndex));
  return perpFills(rows)
    .filter((fill) => fill.size_change !== "0")
    .reverse()
    .slice(0, HISTORY_LIMIT);
}
