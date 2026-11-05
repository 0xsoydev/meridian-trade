import { z } from "zod";

const verifySchema = z.object({
  success: z.boolean().optional(),
  nullifier: z.string().optional(),
  nullifier_hash: z.string().optional(),
});

export type WorldCheck = { worldNullifier: string } | { error: string };

export async function verifyWorld(payload: unknown): Promise<WorldCheck> {
  const rpId = process.env.WORLD_RP_ID;
  if (!rpId) return { error: "world verification is not configured" };
  const base = process.env.WORLD_VERIFY_URL ?? "https://developer.world.org/api/v4/verify";
  try {
    const response = await fetch(`${base}/${rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { error: `world verification answered ${response.status}` };
    const parsed = verifySchema.safeParse(await response.json());
    const nullifier = parsed.success ? (parsed.data.nullifier ?? parsed.data.nullifier_hash) : undefined;
    if (!parsed.success || parsed.data.success !== true || !nullifier || !/^\d{1,78}$/.test(nullifier)) {
      return { error: "world verification was refused" };
    }
    return { worldNullifier: nullifier };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "world verification failed" };
  }
}
