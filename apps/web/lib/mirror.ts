export type DepositCheck = { txId: string; amountMicro: bigint; payer: string } | { error: string };

type TokenTransfer = { token_id?: string; account?: string; amount?: number };
type MirrorTransaction = { result?: string; memo?: string; token_transfers?: TokenTransfer[] };

export const depositMemo = (keyId: string): string => Buffer.from(keyId).toString("base64");

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

  const response = await fetch(`${base}/api/v2/transactions/${normalized}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { error: `the mirror node answered ${response.status}` };
  const body = (await response.json()) as { transactions?: MirrorTransaction[] };
  const transaction = body.transactions?.[0];
  if (!transaction) return { error: "transaction not found on the mirror" };
  if (transaction.result !== "SUCCESS") return { error: `transaction ended ${transaction.result ?? "unknown"}` };

  const memo = Buffer.from(transaction.memo ?? "", "base64").toString("utf8");
  if (memo !== keyId) return { error: "the transaction memo is not this key" };

  const transfers = transaction.token_transfers ?? [];
  const incoming = transfers.find((entry) => entry.token_id === asset && entry.account === treasury && (entry.amount ?? 0) > 0);
  if (!incoming?.amount) return { error: "no USDC transfer to the treasury in that transaction" };
  const outgoing = transfers.find((entry) => entry.token_id === asset && (entry.amount ?? 0) < 0);

  return { txId: normalized, amountMicro: BigInt(incoming.amount), payer: outgoing?.account ?? "unknown" };
}
