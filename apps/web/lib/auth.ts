import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { isAddress, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
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

export function expectedHost(request: Request): string {
  const configured = process.env.PUBLIC_HOST;
  if (configured) {
    try {
      return new URL(configured).host;
    } catch {
      return configured;
    }
  }
  return request.headers.get("host") ?? new URL(request.url).host;
}

const envelopeSchema = z.object({
  address: z.custom<Address>((value) => typeof value === "string" && isAddress(value, { strict: false })),
  message: z.string().min(1).max(2000),
  signature: z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value)),
});

const intentSchema = z.object({ domain: z.string(), action: z.string(), issued_at: z.string() }).passthrough();

export async function verifySigned(
  envelope: unknown,
  host: string,
  action: string,
): Promise<{ address: string; intent: Record<string, unknown> } | null> {
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.message);
  } catch {
    return null;
  }
  const intent = intentSchema.safeParse(raw);
  if (!intent.success) return null;
  if (intent.data.domain !== host || intent.data.action !== action) return null;
  const age = Date.now() - Date.parse(intent.data.issued_at);
  if (!Number.isFinite(age) || age < -60_000 || age > 300_000) return null;
  try {
    const valid = await verifyMessage({
      address: parsed.data.address,
      message: parsed.data.message,
      signature: parsed.data.signature,
    });
    if (!valid) return null;
  } catch {
    return null;
  }
  return { address: parsed.data.address.toLowerCase(), intent: intent.data };
}
