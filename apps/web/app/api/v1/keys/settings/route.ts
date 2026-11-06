import { eq } from "drizzle-orm";
import { z } from "zod";
import { startApproval } from "../../../../../lib/approvals.ts";
import { routerKey } from "../../../../../lib/auth.ts";
import { db } from "../../../../../lib/db.ts";
import { fail } from "../../../../../lib/errors.ts";
import { balanceOf } from "../../../../../lib/ledger.ts";
import { reference } from "../../../../../lib/rails.ts";
import { keys } from "../../../../../lib/schema.ts";
import { TOPUP_MAX_MICRO } from "../../../../../lib/price.ts";

const micro = z.string().regex(/^\d{1,13}$/);

const settingsSchema = z
  .object({
    auto_topup_usd_micro: micro.optional(),
    daily_topup_cap_usd_micro: micro.optional(),
    default_model: z.string().min(1).nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid settings");
  const input = parsed.data;

  const changes: Partial<typeof keys.$inferInsert> = {};
  if (input.auto_topup_usd_micro !== undefined) {
    const value = BigInt(input.auto_topup_usd_micro);
    if (value > TOPUP_MAX_MICRO) {
      return fail(400, "invalid_request", `auto_topup_usd_micro must be at most ${TOPUP_MAX_MICRO}`);
    }
    changes.autoTopupUsdMicro = value;
  }
  if (input.daily_topup_cap_usd_micro !== undefined) {
    const value = BigInt(input.daily_topup_cap_usd_micro);
    if (value > key.dailyTopupCapUsdMicro) {
      if (key.worldSub === null) {
        const approval = await startApproval(key.id, "link_human", null);
        return fail(403, "approval_required", "link a human to this key first", {}, approval);
      }
      const approval = await startApproval(key.id, "raise_cap", value);
      return fail(403, "approval_required", "raising the daily cap needs World approval", {}, approval);
    }
    changes.dailyTopupCapUsdMicro = value;
  }
  if (input.default_model !== undefined) {
    if (input.default_model !== null && !(await reference(input.default_model))) {
      return fail(404, "model_not_found", `unknown model: ${input.default_model}`);
    }
    changes.defaultModel = input.default_model;
  }

  if (Object.keys(changes).length > 0) await db().update(keys).set(changes).where(eq(keys.id, key.id));
  const balance = await balanceOf(key.id);
  return balance ? Response.json(balance) : fail(401, "invalid_api_key", "invalid router key");
}
