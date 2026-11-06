import assert from "node:assert/strict";
import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { createPublicClient, createWalletClient, erc20Abi, http, isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hederaTestnet } from "viem/chains";
import { z } from "zod";
import { hederaClient } from "../lib/hcs.ts";
import { evmAddressOf, treasuryEvm } from "../lib/mirror.ts";

const BASE = (process.env.ROUTER_URL ?? process.env.PUBLIC_HOST ?? "http://localhost:3000").replace(/\/+$/, "");
const MIRROR = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const MODEL = process.env.MODEL ?? "deepseek-v4.1-flash";
const DEPOSIT_MICRO = 100_000;
const WALLET_DEPOSIT_MICRO = 50_000;
const GAS_HBAR = 1;
const BUY_TOKENS = "10000";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const wallet = privateKeyToAccount(generatePrivateKey());
const message = JSON.stringify({ domain: new URL(BASE).host, action: "create_key", issued_at: new Date().toISOString() });
const signup = await fetch(`${BASE}/api/v1/keys`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: wallet.address, message, signature: await wallet.signMessage({ message }) }),
});
if (!signup.ok) throw new Error(`signup answered ${signup.status}: ${await signup.text()}`);
const { key, key_id: keyId } = z
  .object({ key: z.string().startsWith("rk_"), key_id: z.string().min(1) })
  .parse(await signup.json());
console.log(`signup     ${wallet.address} -> key ${keyId}`);
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };

const payer = required("HEDERA_AGENT_ID");
const secret = required("HEDERA_AGENT_KEY").replace(/^0x/, "");
const client = Client.forTestnet().setOperator(
  payer,
  secret.startsWith("302a") || secret.startsWith("302e") ? PrivateKey.fromStringDer(secret) : PrivateKey.fromStringECDSA(secret),
);
const usdc = process.env.HEDERA_USDC ?? "0.0.429274";
const transfer = await new TransferTransaction()
  .addTokenTransfer(usdc, payer, -DEPOSIT_MICRO)
  .addTokenTransfer(usdc, required("HEDERA_TREASURY_ID"), DEPOSIT_MICRO)
  .setTransactionMemo(keyId)
  .execute(client);
await transfer.getReceipt(client);
client.close();
const txId = transfer.transactionId.toString();
console.log(`deposit    ${txId}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deposit = (id: string): Promise<Response> =>
  fetch(`${BASE}/api/v1/keys/deposit`, { method: "POST", headers, body: JSON.stringify({ tx_id: id }) });

async function credited(id: string, amountMicro: number): Promise<bigint> {
  let response = await deposit(id);
  for (let attempt = 0; response.status === 400 && attempt < 20; attempt++) {
    await sleep(3000);
    response = await deposit(id);
  }
  if (!response.ok) throw new Error(`deposit answered ${response.status}: ${await response.text()}`);
  const { balance_usd_micro: balance } = z
    .object({ amount_usd_micro: z.literal(String(amountMicro)), balance_usd_micro: z.string() })
    .parse(await response.json());
  assert.equal((await deposit(id)).status, 409);
  return BigInt(balance);
}

const memoFunded = await credited(txId, DEPOSIT_MICRO);
console.log(`credited   ${memoFunded} micro USD; the replay was refused`);

const treasury = hederaClient();
const treasuryId = treasury.operatorAccountId;
const treasuryAlias = await treasuryEvm();
const usdcEvm = evmAddressOf(usdc);
if (!treasuryId || !treasuryAlias || !isAddress(treasuryAlias) || !usdcEvm || !isAddress(usdcEvm)) {
  throw new Error("the treasury and Hedera USDC must be configured");
}
const alias = AccountId.fromEvmAddress(0, 0, wallet.address);
await (
  await new TransferTransaction()
    .addHbarTransfer(treasuryId, new Hbar(-GAS_HBAR))
    .addHbarTransfer(alias, new Hbar(GAS_HBAR))
    .addTokenTransfer(usdc, treasuryId, -WALLET_DEPOSIT_MICRO)
    .addTokenTransfer(usdc, alias, WALLET_DEPOSIT_MICRO)
    .execute(treasury)
).getReceipt(treasury);
treasury.close();
for (let attempt = 0; !(await fetch(`${MIRROR}/api/v1/accounts/${wallet.address}`)).ok; attempt++) {
  if (attempt === 20) throw new Error(`${wallet.address} never appeared on the mirror`);
  await sleep(2000);
}
const hash = await createWalletClient({ account: wallet, chain: hederaTestnet, transport: http() }).writeContract({
  address: usdcEvm,
  abi: erc20Abi,
  functionName: "transfer",
  args: [treasuryAlias, BigInt(WALLET_DEPOSIT_MICRO)],
});
const receipt = await createPublicClient({ chain: hederaTestnet, transport: http() }).waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
const funded = await credited(hash, WALLET_DEPOSIT_MICRO);
assert.equal(funded, memoFunded + BigInt(WALLET_DEPOSIT_MICRO));
console.log(`wallet     ${hash} sent ${WALLET_DEPOSIT_MICRO} micro USDC on chain 296; credited, and the replay was refused`);

const traded = await fetch(`${BASE}/api/v1/trades`, {
  method: "POST",
  headers,
  body: JSON.stringify({ model: MODEL, tokens: BUY_TOKENS }),
});
if (!traded.ok) throw new Error(`trade answered ${traded.status}: ${await traded.text()}`);
const trade = z
  .object({ fills: z.array(z.object({ charge_usd_micro: z.string() })).min(1), prepaid_tokens: z.literal(BUY_TOKENS) })
  .parse(await traded.json());
const cost = trade.fills.reduce((sum, fill) => sum + BigInt(fill.charge_usd_micro), 0n);
console.log(`bought     ${BUY_TOKENS} ${MODEL} tokens for ${cost} micro USD in ${trade.fills.length} fill(s)`);

const chat = await fetch(`${BASE}/api/v1/chat/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({ model: MODEL, max_tokens: 256, messages: [{ role: "user", content: "Answer in one word: ready?" }] }),
});
if (!chat.ok) throw new Error(`chat answered ${chat.status}: ${await chat.text()}`);
const completion = z
  .object({
    id: z.string().optional(),
    x_0g_trace: z.object({ request_id: z.string() }).optional(),
    choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
    usage: z.object({ total_tokens: z.number().int().positive() }),
  })
  .parse(await chat.json());
console.log(
  `inference  ${completion.usage.total_tokens} tokens, request ${completion.x_0g_trace?.request_id ?? completion.id ?? "unknown"}: ${completion.choices[0]?.message.content ?? ""}`,
);

const balance = await fetch(`${BASE}/api/v1/balance`, { headers });
const after = z
  .object({ balance_usd_micro: z.string(), reserved_usd_micro: z.literal("0") })
  .parse(await balance.json());
assert.equal(BigInt(after.balance_usd_micro), funded - cost);
console.log(`balance    ${after.balance_usd_micro} micro USD; the call spent prepaid tokens, not cash`);
