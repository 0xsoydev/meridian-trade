import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db.ts";
import { keys, type KeyRow } from "./schema.ts";

export function hashKey(raw: string): Buffer {
  return createHash("sha256").update(raw).digest();
}

export async function routerKey(request: Request): Promise<KeyRow | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice(7).trim();
  if (!raw.startsWith("rk_")) return null;
  const rows = await db().select().from(keys).where(eq(keys.hash, hashKey(raw))).limit(1);
  return rows[0] ?? null;
}
