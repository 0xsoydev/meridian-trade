import { z } from "zod";
import { routerKey } from "../../../../../lib/auth.ts";
import { fail } from "../../../../../lib/errors.ts";
import { credit } from "../../../../../lib/ledger.ts";
import { verifyDeposit } from "../../../../../lib/mirror.ts";
import { TOPUP_MAX_MICRO } from "../../../../../lib/x402.ts";
import type { DepositResult } from "../../../../../lib/types";

const schema = z.object({ tx_id: z.string().min(1).max(80) });

export async function POST(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "expected { tx_id }");

  const deposit = await verifyDeposit(parsed.data.tx_id, key.id);
  if ("error" in deposit) return fail(400, "invalid_request", deposit.error);
  if (deposit.amountMicro > TOPUP_MAX_MICRO) {
    return fail(400, "invalid_request", `a single deposit carries at most ${TOPUP_MAX_MICRO} micro USD`);
  }

  const balance = await credit(key.id, { txId: deposit.txId, amountMicro: deposit.amountMicro, payer: deposit.payer });
  if (balance === null) return fail(409, "invalid_request", "this transaction was already credited");

  const result: DepositResult = {
    tx_id: deposit.txId,
    amount_usd_micro: deposit.amountMicro.toString(),
    balance_usd_micro: balance.toString(),
  };
  return Response.json(result);
}
