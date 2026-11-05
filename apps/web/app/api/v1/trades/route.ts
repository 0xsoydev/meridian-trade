import { z } from "zod";
import { routerKey } from "../../../../lib/auth.ts";
import { asks, type Ask } from "../../../../lib/book.ts";
import { fail } from "../../../../lib/errors.ts";
import { fill, prepaidHolding } from "../../../../lib/ledger.ts";
import { charge, sellerEarning } from "../../../../lib/price.ts";
import { reference } from "../../../../lib/rails.ts";
import { applyPayment, paymentDue } from "../../../../lib/x402.ts";
import type { Trade, TradeResult } from "../../../../lib/types";

const MAX_TRADE_TOKENS = 1_000_000_000n;

const intentSchema = z.object({ model: z.string().min(1), tokens: z.string().regex(/^\d{1,13}$/) });

type Step = { ask: Ask; take: bigint; cost: bigint };

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export async function POST(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = intentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "expected { model, tokens } with tokens as an integer string");
  const { model } = parsed.data;
  const tokens = BigInt(parsed.data.tokens);
  if (tokens <= 0n || tokens > MAX_TRADE_TOKENS) {
    return fail(400, "invalid_request", `tokens must be between 1 and ${MAX_TRADE_TOKENS}`);
  }
  if (!(await reference(model))) return fail(404, "model_not_found", `unknown model: ${model}`);

  const payment = await applyPayment(request, key);
  if ("error" in payment) return payment.error;
  const headers: Record<string, string> = payment.header ? { "PAYMENT-RESPONSE": payment.header } : {};

  const steps: Step[] = [];
  let left = tokens;
  let quote = 0n;
  for (const ask of await asks(model)) {
    if (left === 0n) break;
    const take = ask.tokensLeft < left ? ask.tokensLeft : left;
    const cost = charge(take, ask.price);
    steps.push({ ask, take, cost });
    quote += cost;
    left -= take;
  }
  if (steps.length === 0) return fail(404, "no_liquidity", `no asks for ${model}`);

  const due = await paymentDue(request, key.id, quote);
  if (due) return due;

  const takeBps = BigInt(process.env.TAKE_BPS ?? "1000");
  const now = new Date();
  const fills: Trade[] = [];
  for (const step of steps) {
    const result = await fill({
      keyId: key.id,
      listingId: step.ask.listingId,
      model,
      tokens: step.take,
      price: step.ask.price,
      chargeMicro: step.cost,
      sellerEarningMicro: sellerEarning(step.cost, takeBps),
      expiresAt: step.ask.rail.resetPeriod === "daily" ? nextUtcMidnight(now) : null,
    });
    if (result.listingOk && !result.keyOk) break;
    if (!result.listingOk) continue;
    fills.push({
      listing_id: step.ask.listingId,
      tokens: step.take.toString(),
      price_micro_per_mtok: step.ask.price.toString(),
      charge_usd_micro: step.cost.toString(),
    });
  }
  if (fills.length === 0) return fail(409, "no_liquidity", "the asks moved before they could be filled; retry");

  const result: TradeResult = { fills, prepaid_tokens: (await prepaidHolding(key.id, model)).toString() };
  return Response.json(result, { headers });
}
