import { createHash } from "node:crypto";
import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.ts";
import { usage } from "./schema.ts";
import type { Rollup } from "./types";

export type Fill = { id: string; keyId: string; model: string; price: bigint; charge: bigint; tokens: bigint; usage: boolean };

const fillRowSchema = z.object({
  id: z.string().uuid(),
  key_id: z.string().uuid(),
  model: z.string(),
  price: z.string().regex(/^\d+$/),
  charge: z.string().regex(/^\d+$/),
  tokens: z.string().regex(/^\d+$/),
  source: z.enum(["usage", "trade"]),
});

export async function minuteFills(minute: number): Promise<Fill[]> {
  const from = new Date(minute * 60_000).toISOString();
  const to = new Date((minute + 1) * 60_000).toISOString();
  const result = await db().execute(sql`
    select u.id, u.key_id, l.model, u.price_micro_per_mtok::text as price, u.charge_usd_micro::text as charge, u.mixed_tokens::text as tokens, 'usage' as source
    from usage u join listings l on l.id = u.listing_id
    where u.status = 'settled' and u.charge_usd_micro > 0 and u.mixed_tokens > 0
      and u.settled_at >= ${from}::timestamptz and u.settled_at < ${to}::timestamptz
    union all
    select t.id, t.key_id, t.model, t.price_micro_per_mtok::text, t.charge_usd_micro::text, t.tokens::text, 'trade'
    from trades t
    where t.created_at >= ${from}::timestamptz and t.created_at < ${to}::timestamptz
    order by id
  `);
  return result.rows.map((raw) => {
    const row = fillRowSchema.parse(raw);
    return {
      id: row.id,
      keyId: row.key_id,
      model: row.model,
      price: BigInt(row.price),
      charge: BigInt(row.charge),
      tokens: BigInt(row.tokens),
      usage: row.source === "usage",
    };
  });
}

function sha256(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

export function merkleRoot(fills: ReadonlyArray<Fill>): string {
  let level = fills.map((f) => sha256(`${f.id}|${f.keyId}|${f.charge}|${f.tokens}`));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (left) next.push(right ? sha256(Buffer.concat([left, right])) : left);
    }
    level = next;
  }
  return (level[0] ?? sha256("")).toString("hex");
}

export function buildRollups(minute: number, fills: ReadonlyArray<Fill>): Rollup[] {
  const byModel = Map.groupBy(fills, (f) => f.model);
  return [...byModel].map(([model, group]) => {
    const charge = group.reduce((sum, f) => sum + f.charge, 0n);
    const tokens = group.reduce((sum, f) => sum + f.tokens, 0n);
    const notional = group.reduce((sum, f) => sum + f.price * f.tokens, 0n);
    return {
      v: 1,
      model,
      minute,
      fills: group.length,
      mixed_tokens: tokens.toString(),
      charge_usd_micro: charge.toString(),
      vwap_micro_per_mtok: (notional / tokens).toString(),
      usage_root: merkleRoot(group),
    };
  });
}

function treasury(): { id: string; key: string; topic: string } {
  const id = process.env.HEDERA_TREASURY_ID;
  const key = process.env.HEDERA_TREASURY_KEY;
  const topic = process.env.HCS_TOPIC_ID;
  if (!id || !key || !topic) throw new Error("HEDERA_TREASURY_ID, HEDERA_TREASURY_KEY and HCS_TOPIC_ID are required");
  return { id, key, topic };
}

let client: Client | null = null;

export function hederaClient(): Client {
  if (!client) {
    const { id, key } = treasury();
    const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
    client = (network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(
      id,
      PrivateKey.fromStringECDSA(key),
    );
  }
  return client;
}

export async function submitRollup(rollup: Rollup): Promise<number> {
  const message = JSON.stringify(rollup);
  if (Buffer.byteLength(message) >= 1024) throw new Error(`rollup for ${rollup.model} is ${message.length} bytes`);
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(treasury().topic)
    .setMessage(message)
    .execute(hederaClient());
  const receipt = await response.getReceipt(hederaClient());
  return Number(receipt.topicSequenceNumber ?? 0);
}

export async function markPublished(minute: number, fills: ReadonlyArray<Fill>): Promise<void> {
  const ids = fills.filter((f) => f.usage).map((f) => f.id);
  if (ids.length > 0) await db().update(usage).set({ hcsMinute: BigInt(minute) }).where(inArray(usage.id, ids));
}
