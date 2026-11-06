import { matchAllBids } from "../apps/web/lib/bids.ts";
import { asks } from "../apps/web/lib/book.ts";
import { keeperWallet, publicClient } from "../apps/web/lib/chain.ts";
import { buildRollups, markPublished, minuteFills, submitRollup } from "../apps/web/lib/hcs.ts";
import { releaseStale } from "../apps/web/lib/ledger.ts";
import { checkScheduled, closeDay, payPending, resetDailyListings, utcDay } from "../apps/web/lib/payouts.ts";
import { LOG_CHUNK, MARKETS, liquidate, needsLiquidation, postIndex, readMarket } from "../apps/web/lib/perp.ts";
import { readPerpEvents, recordPerpEvents, recordedPerps } from "../apps/web/lib/perp-events.ts";
import { blended, marketPrice, referenceFor } from "../apps/web/lib/price.ts";
import { catalog } from "../apps/web/lib/rails.ts";
import { clampIndex, minuteOf, readRollups, shouldPost, stepToward, twap } from "../apps/web/lib/rollup.ts";

const SETTLE_GRACE_MS = 5_000;
const SCAN_CHUNKS_PER_TICK = 30;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function windowMinutes(): number {
  const value = Number(process.env.INDEX_WINDOW_MIN ?? "60");
  if (!Number.isInteger(value) || value <= 0) throw new Error("INDEX_WINDOW_MIN must be a positive integer");
  return value;
}

function mirror() {
  return {
    mirrorUrl: process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com",
    topicId: required("HCS_TOPIC_ID"),
    payer: required("HEDERA_TREASURY_ID"),
  };
}

function isExpectedRevert(error: unknown): boolean {
  const text = String(error);
  return text.includes("StalePrice") || text.includes("NotLiquidatable");
}

async function confirmed(hash: `0x${string}`): Promise<void> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
}

let lastMinute: number | null = null;

export async function publishRollups(): Promise<boolean> {
  const closed = minuteOf(Date.now() - SETTLE_GRACE_MS) - 1;
  if (lastMinute === null) {
    const published = await readRollups({ ...mirror(), sinceMinute: closed - windowMinutes() });
    lastMinute = published.reduce((max, p) => Math.max(max, p.rollup.minute), closed - windowMinutes() - 1);
  }
  let filled = false;
  for (let minute = lastMinute + 1; minute <= closed; minute++) {
    const fills = await minuteFills(minute);
    for (const rollup of buildRollups(minute, fills)) {
      const seq = await submitRollup(rollup);
      console.log(`[rollup] ${rollup.model} minute ${minute}: ${rollup.fills} fills, vwap ${rollup.vwap_micro_per_mtok}, seq ${seq}`);
    }
    await markPublished(minute, fills);
    filled ||= fills.length > 0;
    lastMinute = minute;
  }
  return filled;
}

export async function postIndexes(): Promise<void> {
  const wallet = keeperWallet();
  const rails = await catalog();
  const published = await readRollups({ ...mirror(), sinceMinute: minuteOf(Date.now()) - windowMinutes() });
  for (const model of MARKETS) {
    try {
      const ref = referenceFor(model, rails);
      if (!ref) {
        console.log(`[index] ${model}: no reference price, skipped`);
        continue;
      }
      const mine = published.filter((p) => p.rollup.model === model);
      const rail = rails.find((r) => r.id === ref.railId);
      const source =
        twap(mine.map((p) => p.rollup)) ??
        (await asks(model))[0]?.price ??
        (rail ? marketPrice(null, ref.pricing, rail) : null);
      if (source === null) {
        console.log(`[index] ${model}: no bid, nothing to post`);
        continue;
      }
      const target = clampIndex(source, blended(ref.pricing));
      const market = await readMarket(model);
      const next = stepToward(target, market.price);
      if (!shouldPost(next, market.price, market.updatedAt, BigInt(Math.floor(Date.now() / 1000)))) continue;
      const hash = await postIndex(wallet, model, next, BigInt(mine[0]?.seq ?? 0), BigInt(mine.at(-1)?.seq ?? 0));
      await confirmed(hash);
      const basis = mine.length > 0 ? `twap of ${mine.length} min` : "no fills";
      console.log(`[index] ${model}: ${market.price} -> ${next} (target ${target}, ${basis}) tx ${hash}`);
    } catch (error) {
      console.error(`[index] ${model}:`, error instanceof Error ? error.message : error);
    }
  }
}

let scannedTo: bigint | null = null;
const tracked = new Map<string, { account: `0x${string}`; model: string }>();

export async function liquidateUnderwater(): Promise<void> {
  const deployBlock = required("PERP_DEPLOY_BLOCK");
  if (!/^\d+$/.test(deployBlock)) throw new Error("PERP_DEPLOY_BLOCK must be a block number");
  if (scannedTo === null) {
    const recorded = await recordedPerps();
    scannedTo = recorded.lastBlock ?? BigInt(deployBlock) - 1n;
    for (const { account, model } of recorded.positions) tracked.set(`${account}|${model}`, { account, model });
  }
  let done = scannedTo;
  const head = await publicClient().getBlockNumber();
  for (let chunk = 0; done < head && chunk < SCAN_CHUNKS_PER_TICK; chunk++) {
    const to: bigint = done + LOG_CHUNK < head ? done + LOG_CHUNK : head;
    const events = await readPerpEvents(done + 1n, to);
    await recordPerpEvents(events);
    for (const { account, model } of events) tracked.set(`${account}|${model}`, { account, model });
    done = to;
    scannedTo = done;
  }
  const wallet = keeperWallet();
  for (const { account, model } of tracked.values()) {
    try {
      if (!(await needsLiquidation(account, model))) continue;
      const hash = await liquidate(wallet, account, model);
      await confirmed(hash);
      console.log(`[liquidate] ${account} on ${model} tx ${hash}`);
    } catch (error) {
      if (isExpectedRevert(error)) console.log(`[liquidate] ${account} on ${model}: skipped this tick (stale price or recovered)`);
      else console.error(`[liquidate] ${account} on ${model}:`, error instanceof Error ? error.message : error);
    }
  }
}

export async function sweepStale(): Promise<void> {
  const released = await releaseStale();
  if (released > 0) console.log(`[sweep] released ${released} stale usage rows`);
}

export async function matchRestingBids(): Promise<void> {
  const filled = await matchAllBids();
  if (filled > 0) console.log(`[match] ${filled} resting bid fills`);
}

const printed = new Set<string>();

export async function dailyClose(): Promise<void> {
  const now = Date.now();
  const today = utcDay(now);
  const yesterday = utcDay(now - 86_400_000);
  const created = await closeDay(yesterday);
  if (created > 0) console.log(`[payout] closed ${yesterday}: ${created} payouts pending`);
  for (const line of [...(await payPending()), ...(await checkScheduled())]) {
    if (printed.has(line)) continue;
    printed.add(line);
    console.log(line);
  }
  const reset = await resetDailyListings(today);
  if (reset > 0) console.log(`[reset] ${reset} daily listings reset for ${today}`);
}
