import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.ts";
import { comfyAgents, usage, type KeyRow } from "./schema.ts";

export const agentName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/);

export type ComfyAgent = { agent: string; since: Date; requests: number; spentUsdMicro: bigint };

export async function connectComfy(key: KeyRow, agent: string): Promise<"connected" | "unverified"> {
  if (key.worldSub === null) return "unverified";
  await db()
    .insert(comfyAgents)
    .values({ keyId: key.id, agent })
    .onConflictDoUpdate({ target: comfyAgents.keyId, set: { agent } });
  return "connected";
}

export async function listComfy(limit = 50): Promise<ComfyAgent[]> {
  const settled = sql`${usage.status} = 'settled'`;
  return db()
    .select({
      agent: comfyAgents.agent,
      since: comfyAgents.createdAt,
      requests: sql`count(${usage.id}) filter (where ${settled})`.mapWith(Number),
      spentUsdMicro: sql`coalesce(sum(${usage.chargeUsdMicro}) filter (where ${settled}), 0)`.mapWith(BigInt),
    })
    .from(comfyAgents)
    .leftJoin(usage, eq(usage.keyId, comfyAgents.keyId))
    .groupBy(comfyAgents.keyId, comfyAgents.agent, comfyAgents.createdAt)
    .orderBy(desc(comfyAgents.createdAt))
    .limit(limit);
}
