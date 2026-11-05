import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { hashKey } from "./auth.ts";
import { db } from "./db.ts";
import { accounts, keys } from "./schema.ts";
import type { KeySummary } from "./types";

export async function ensureAccount(
  address: string,
  worldNullifier: string | null,
): Promise<{ id: string } | { conflict: true }> {
  if (worldNullifier !== null) {
    const clash = await db().select().from(accounts).where(eq(accounts.worldNullifier, worldNullifier)).limit(1);
    if (clash[0] && clash[0].address !== address) return { conflict: true };
  }
  const existing = await db().select().from(accounts).where(eq(accounts.address, address)).limit(1);
  if (existing[0]) {
    if (worldNullifier !== null && existing[0].worldNullifier === null) {
      await db().update(accounts).set({ worldNullifier }).where(eq(accounts.id, existing[0].id));
    }
    return { id: existing[0].id };
  }
  const [created] = await db().insert(accounts).values({ address, worldNullifier }).returning({ id: accounts.id });
  return created ? { id: created.id } : { conflict: true };
}

export async function createKey(accountId: string): Promise<{ id: string; raw: string }> {
  const raw = `rk_${randomBytes(32).toString("base64url")}`;
  const [row] = await db()
    .insert(keys)
    .values({ accountId, hash: hashKey(raw), balanceUsdMicro: 0n })
    .returning({ id: keys.id });
  if (!row) throw new Error("key creation failed");
  return { id: row.id, raw };
}

export async function listKeys(accountId: string): Promise<KeySummary[]> {
  const rows = await db()
    .select({ id: keys.id, balance: keys.balanceUsdMicro, createdAt: keys.createdAt })
    .from(keys)
    .where(eq(keys.accountId, accountId))
    .orderBy(desc(keys.createdAt));
  return rows.map((row) => ({
    key_id: row.id,
    balance_usd_micro: row.balance.toString(),
    created_at: row.createdAt.toISOString(),
  }));
}
