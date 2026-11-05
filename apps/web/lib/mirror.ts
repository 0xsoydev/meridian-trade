import { z } from "zod";

export type DepositCheck = { txId: string; amountMicro: bigint; payer: string } | { error: string };

const transactionsSchema = z.object({
  transactions: z.array(
    z.object({
      result: z.string(),
      memo_base64: z.string().nullable(),
      token_transfers: z
        .array(z.object({ token_id: z.string(), account: z.string(), amount: z.number().int() }))
        .default([]),
    }),
  ),
});

export function normalizeTxId(input: string): string | null {
  const match = /^(\d+\.\d+\.\d+)[@-](\d+)[.-](\d{1,9})$/.exec(input.trim());
  const [, account, seconds, nanos] = match ?? [];
  if (!account || !seconds || !nanos) return null;
  return `${account}-${seconds}-${nanos.padStart(9, "0")}`;
}

export async function verifyDeposit(txId: string, keyId: string): Promise<DepositCheck> {
  const normalized = normalizeTxId(txId);
  if (!normalized) return { error: "transaction id must look like 0.0.x@seconds.nanos" };

  const treasury = process.env.HEDERA_TREASURY_ID;
  if (!treasury) return { error: "deposits are not configured" };
  const asset = process.env.HEDERA_USDC ?? "0.0.429274";
  const base = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

  const response = await fetch(`${base}/api/v1/transactions/${normalized}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { error: "transaction not on the mirror yet; retry in a few seconds" };
  if (!response.ok) return { error: `the mirror node answered ${response.status}` };
  const parsed = transactionsSchema.safeParse(await response.json());
  if (!parsed.success) return { error: "the mirror node answered an unexpected shape" };
  const transaction = parsed.data.transactions[0];
  if (!transaction) return { error: "transaction not on the mirror yet; retry in a few seconds" };
  if (transaction.result !== "SUCCESS") return { error: `transaction ended ${transaction.result}` };

  const memo = Buffer.from(transaction.memo_base64 ?? "", "base64").toString("utf8");
  if (memo !== keyId) return { error: "the transaction memo is not this key" };

  const transfers = transaction.token_transfers.filter((entry) => entry.token_id === asset);
  const incoming = transfers.find((entry) => entry.account === treasury && entry.amount > 0);
  if (!incoming) return { error: "no USDC transfer to the treasury in that transaction" };
  const outgoing = transfers.find((entry) => entry.amount < 0);

  return { txId: normalized, amountMicro: BigInt(incoming.amount), payer: outgoing?.account ?? "unknown" };
}
