import { hashSignal } from "@worldcoin/idkit/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { keccak256, toBytes } from "viem";
import { z } from "zod";

const requestSchema = z
  .object({
    environment: z.string().optional(),
    responses: z
      .array(z.object({ signal_hash: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const verifySchema = z
  .object({
    success: z.boolean().optional(),
    action: z.string().optional(),
    environment: z.string().optional(),
    nullifier: z.string().optional(),
    nullifier_hash: z.string().optional(),
  })
  .passthrough();

export type WorldCheck = { worldNullifier: string } | { error: string };

export type WorldOptions = {
  environment?: string;
  action?: string;
  signal?: string;
};

export type RpSignature = {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
};

export function worldEnvironment(): string {
  return process.env.WORLD_ENV ?? "production";
}

export function signalHash(signal: string): string {
  return hashSignal(signal);
}

export function nullifierToDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (!/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed).toString();
  } catch {
    return null;
  }
}

export function rpSignature(action: string): RpSignature {
  const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY;
  if (!signingKeyHex) throw new Error("WORLD_RP_SIGNING_KEY is not configured");
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex, action });
  return { sig, nonce, created_at: createdAt, expires_at: expiresAt };
}

export function worldBypassed(): boolean {
  return process.env.NEXT_PUBLIC_WORLD_BYPASS === "true" && process.env.NODE_ENV !== "production";
}

export function testNullifier(seed: string): string {
  return BigInt(keccak256(toBytes(`world-bypass:${seed}`))).toString();
}

export async function verifyWorld(payload: unknown, options: WorldOptions = {}): Promise<WorldCheck> {
  if (worldBypassed()) return { worldNullifier: testNullifier(options.signal ?? "") };
  const rpId = process.env.WORLD_RP_ID;
  if (!rpId) return { error: "world verification is not configured" };

  const expectedEnvironment = options.environment ?? worldEnvironment();
  const request = requestSchema.safeParse(payload);
  if (!request.success) return { error: "world payload is malformed" };
  if (request.data.environment !== undefined && request.data.environment !== expectedEnvironment) {
    return { error: "world environment mismatch" };
  }

  if (options.signal !== undefined) {
    const expected = signalHash(options.signal).toLowerCase();
    const responses = request.data.responses ?? [];
    if (responses.length === 0) return { error: "world payload has no responses" };
    const bound = responses.every((response) => response.signal_hash?.toLowerCase() === expected);
    if (!bound) return { error: "world signal does not match" };
  }

  const base = process.env.WORLD_VERIFY_URL ?? "https://developer.world.org/api/v4/verify";
  try {
    const response = await fetch(`${base}/${rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...request.data,
        environment: expectedEnvironment,
        ...(options.action === undefined ? {} : { action: options.action }),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { error: `world verification answered ${response.status}` };

    const parsed = verifySchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.success !== true) {
      return { error: "world verification was refused" };
    }
    if (parsed.data.environment !== undefined && parsed.data.environment !== expectedEnvironment) {
      return { error: "world verification environment mismatch" };
    }
    if (options.action !== undefined && parsed.data.action !== options.action) {
      return { error: "world verification action mismatch" };
    }

    const nullifier = parsed.data.nullifier ?? parsed.data.nullifier_hash;
    const decimal = nullifier ? nullifierToDecimal(nullifier) : null;
    if (!decimal) return { error: "world verification returned no nullifier" };
    return { worldNullifier: decimal };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "world verification failed" };
  }
}
