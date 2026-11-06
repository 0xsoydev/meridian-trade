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

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const contractResultSchema = z.object({
  hash: z.string(),
  result: z.string(),
  from: z.string(),
  logs: z.array(z.object({ address: z.string(), topics: z.array(z.string()), data: z.string() })).default([]),
});

const accountSchema = z.object({ evm_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
const evmAddresses = new Map<string, string>();

export function evmAddressOf(entityId: string): string | null {
  const num = /^0\.0\.(\d+)$/.exec(entityId)?.[1];
  return num ? `0x${BigInt(num).toString(16).padStart(40, "0")}` : null;
}

export async function treasuryEvm(): Promise<string | null> {
  const treasury = process.env.HEDERA_TREASURY_ID;
  if (!treasury) return null;
  const base = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
  const url = `${base}/api/v1/accounts/${treasury}?transactions=false`;
  const known = evmAddresses.get(url);
  if (known) return known;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`the mirror node answered ${response.status}`);
  const address = accountSchema.parse(await response.json()).evm_address.toLowerCase();
  evmAddresses.set(url, address);
  return address;
}

function topicAddress(topic: string | undefined): string {
  return `0x${(topic ?? "").slice(-40)}`.toLowerCase();
}

function accountOf(address: string): string {
  const lower = address.toLowerCase();
  return /^0x0{24}[0-9a-f]{16}$/.test(lower) ? `0.0.${BigInt(`0x${lower.slice(26)}`)}` : lower;
}

export async function verifyWalletDeposit(hash: string, wallet: string): Promise<DepositCheck> {
  const recipient = await treasuryEvm();
  const usdcEvm = evmAddressOf(process.env.HEDERA_USDC ?? "0.0.429274");
  if (!recipient || !usdcEvm) return { error: "deposits are not configured" };
  const base = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

  const response = await fetch(`${base}/api/v1/contracts/results/${hash}`, { signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return { error: "transaction not on the mirror yet; retry in a few seconds" };
  if (!response.ok) return { error: `the mirror node answered ${response.status}` };
  const parsed = contractResultSchema.safeParse(await response.json());
  if (!parsed.success) return { error: "the mirror node answered an unexpected shape" };
  if (parsed.data.hash.toLowerCase() !== hash.toLowerCase()) return { error: "that hash names another transaction" };
  if (parsed.data.result !== "SUCCESS") return { error: `transaction ended ${parsed.data.result}` };

  const sender = wallet.toLowerCase();
  const amount = parsed.data.logs
    .filter(
      (log) =>
        log.address.toLowerCase() === usdcEvm &&
        log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
        topicAddress(log.topics[1]) === sender &&
        topicAddress(log.topics[2]) === recipient &&
        /^0x[0-9a-fA-F]{64}$/.test(log.data),
    )
    .reduce((sum, log) => sum + BigInt(log.data), 0n);
  if (amount === 0n) return { error: "no USDC transfer from this wallet to the treasury in that transaction" };
  return { txId: hash.toLowerCase(), amountMicro: amount, payer: accountOf(parsed.data.from) };
}

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
