import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { createFundedKey } from "../../../../lib/ledger.ts";
import { parseUsd, TOPUP_MAX_MICRO, TOPUP_MIN_MICRO } from "../../../../lib/price.ts";
import { creditSettlement, paymentRequired, settleTopup } from "../../../../lib/x402.ts";
import type { TopupResult } from "../../../../lib/types";

export async function POST(request: Request): Promise<Response> {
  const amount = parseUsd(new URL(request.url).searchParams.get("usd") ?? "0.50");
  if (amount === null || amount < TOPUP_MIN_MICRO || amount > TOPUP_MAX_MICRO) {
    return fail(400, "invalid_request", "usd must be between 0.10 and 20.00");
  }

  const authorized = request.headers.has("authorization");
  const key = authorized ? await routerKey(request) : null;
  if (authorized && !key) return fail(401, "invalid_api_key", "invalid router key");

  const header = request.headers.get("payment-signature");
  if (!header) return paymentRequired(amount, request.url, `pay ${amount} micro USD to top up`);

  const settled = await settleTopup(header, { minMicro: TOPUP_MIN_MICRO, maxMicro: TOPUP_MAX_MICRO });
  if ("error" in settled) return fail(402, "insufficient_balance", `payment failed: ${settled.error}`);
  const headers = { "PAYMENT-RESPONSE": settled.responseHeader };

  if (key) {
    const balance = await creditSettlement(key.id, settled);
    if (balance instanceof Response) return balance;
    const result: TopupResult = { key_id: key.id, balance_usd_micro: balance.toString(), tx_id: settled.txId };
    return Response.json(result, { headers });
  }

  try {
    const created = await createFundedKey(settled);
    if (!created) return fail(409, "invalid_request", "this payment was already credited");
    const result: TopupResult = {
      key: created.rawKey,
      key_id: created.keyId,
      balance_usd_micro: created.balance.toString(),
      tx_id: settled.txId,
    };
    return Response.json(result, { headers });
  } catch (error) {
    console.error("payment settled but no key was created", settled.txId, error);
    return fail(502, "upstream_failed", `payment ${settled.txId} settled but no key was created; quote this id to support`);
  }
}
