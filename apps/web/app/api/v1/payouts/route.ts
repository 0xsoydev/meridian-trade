import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { payouts, sellers } from "../../../../lib/schema.ts";
import type { SellerPayouts } from "../../../../lib/types";

export async function GET(request: Request): Promise<Response> {
  const address = (new URL(request.url).searchParams.get("seller") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return fail(400, "invalid_request", "seller must be a wallet address");

  const network = (process.env.HEDERA_NETWORK ?? "hedera:testnet").split(":")[1] ?? "testnet";
  const [seller] = await db().select({ id: sellers.id }).from(sellers).where(eq(sellers.address, address)).limit(1);
  if (!seller) return Response.json({ network, unpaid_usd_micro: "0", data: [] } satisfies SellerPayouts);

  const [rows, unpaid] = await Promise.all([
    db()
      .select({
        day: payouts.day,
        amount: payouts.amountUsdMicro,
        scheduleId: payouts.scheduleId,
        executeAt: payouts.executeAt,
        status: payouts.status,
      })
      .from(payouts)
      .where(eq(payouts.sellerId, seller.id))
      .orderBy(desc(payouts.day))
      .limit(60),
    db().execute<{ unpaid: string }>(sql`
      select coalesce(sum(amount), 0)::text as unpaid from (
        select usage.seller_earning_usd_micro as amount
        from usage join listings on listings.id = usage.listing_id
        where listings.seller_id = ${seller.id} and usage.status = 'settled' and usage.payout_id is null
        union all
        select trades.seller_earning_usd_micro
        from trades join listings on listings.id = trades.listing_id
        where listings.seller_id = ${seller.id} and trades.payout_id is null and trades.seller_key_id is null
      ) earned
    `),
  ]);

  const result: SellerPayouts = {
    network,
    unpaid_usd_micro: unpaid.rows[0]?.unpaid ?? "0",
    data: rows.map((row) => ({
      day: row.day,
      amount_usd_micro: row.amount.toString(),
      schedule_id: row.scheduleId,
      execute_at: row.executeAt?.toISOString() ?? null,
      status: row.status,
    })),
  };
  return Response.json(result);
}
