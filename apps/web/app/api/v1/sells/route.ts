import { z } from "zod";
import { routerKey } from "../../../../lib/auth.ts";
import { fail } from "../../../../lib/errors.ts";
import { prepaidHolding } from "../../../../lib/ledger.ts";
import { bestBid, escrowOffer, holdings, sellIntoBid } from "../../../../lib/offers.ts";
import { formatMicroPerMtok, formatMtok, listCeiling } from "../../../../lib/price.ts";
import { catalog, reference } from "../../../../lib/rails.ts";
import type { Offer, SellResult, Trade } from "../../../../lib/types";

const MAX_TRADE_TOKENS = 1_000_000_000n;

const intentSchema = z.object({
  model: z.string().min(1),
  tokens: z.string().regex(/^\d{1,13}$/),
  limit_price_micro_per_mtok: z.string().regex(/^[1-9]\d{0,12}$/).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const key = await routerKey(request);
  if (!key) return fail(401, "invalid_api_key", "invalid router key");

  const parsed = intentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "expected { model, tokens } with tokens as an integer string");
  const { model } = parsed.data;
  const tokens = BigInt(parsed.data.tokens);
  const limit = parsed.data.limit_price_micro_per_mtok === undefined ? null : BigInt(parsed.data.limit_price_micro_per_mtok);
  if (tokens <= 0n || tokens > MAX_TRADE_TOKENS) {
    return fail(400, "invalid_request", `tokens must be between 1 and ${MAX_TRADE_TOKENS}`);
  }
  if (!(await reference(model))) return fail(404, "model_not_found", `unknown model: ${model}`);
  const ceiling = listCeiling(model, await catalog());
  if (limit !== null && ceiling !== null && limit > ceiling) {
    return fail(400, "invalid_request", `the limit is above the ${formatMicroPerMtok(ceiling)} USD/MTok list price, and no ask can sit above it`);
  }

  const rows = (await holdings(key.id, model)).map((row) => ({ ...row, left: row.tokens }));
  const held = rows.reduce((sum, row) => sum + row.tokens, 0n);
  if (held < tokens) return fail(400, "invalid_request", `you hold ${formatMtok(held)} MTok of ${model} to sell`);

  const takeBps = BigInt(process.env.TAKE_BPS ?? "1000");
  const fills: Trade[] = [];
  let left = tokens;
  while (left > 0n) {
    const bid = await bestBid(model, key.id, limit);
    const row = rows.find((candidate) => candidate.left > 0n);
    if (!bid || !row) break;
    const take = [bid.tokens, row.left].reduce((min, value) => (value < min ? value : min), left);
    const sold = await sellIntoBid({ bidId: bid.id, prepaidId: row.prepaidId, sellerKeyId: key.id, take, takeBps });
    if (!sold) break;
    row.left -= take;
    left -= take;
    fills.push({
      listing_id: row.listingId,
      tokens: take.toString(),
      price_micro_per_mtok: bid.price.toString(),
      charge_usd_micro: sold.charge.toString(),
    });
  }
  if (limit === null && fills.length === 0) return fail(404, "no_liquidity", `no bids for ${model}; set a limit price to list your MTokens`);

  const placed: Offer[] = [];
  for (const row of rows) {
    if (limit === null || left === 0n) break;
    if (row.left === 0n) continue;
    const size = row.left < left ? row.left : left;
    const offer = await escrowOffer({ keyId: key.id, prepaidId: row.prepaidId, tokens: size, price: limit });
    if (!offer) continue;
    placed.push(offer);
    left -= size;
  }
  if (fills.length === 0 && placed.length === 0) {
    return fail(409, "invalid_request", "your MTokens were spent before they could be sold; retry");
  }

  const result: SellResult = { fills, offers: placed, holding_tokens: (await prepaidHolding(key.id, model)).toString() };
  return Response.json(result);
}
