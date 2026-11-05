import assert from "node:assert/strict";
import { Client, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE = (process.env.ROUTER_URL ?? process.env.PUBLIC_HOST ?? "http://localhost:3000").replace(/\/+$/, "");
const MODEL = process.env.MODEL ?? "0gm-1.0-35b-a3b";
const DEPOSIT_MICRO = 100_000;
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

const deposit = (): Promise<Response> =>
  fetch(`${BASE}/api/v1/keys/deposit`, { method: "POST", headers, body: JSON.stringify({ tx_id: txId }) });
let credited = await deposit();
for (let attempt = 0; credited.status === 400 && attempt < 20; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  credited = await deposit();
}
if (!credited.ok) throw new Error(`deposit answered ${credited.status}: ${await credited.text()}`);
const { balance_usd_micro: funded } = z
  .object({ amount_usd_micro: z.literal(String(DEPOSIT_MICRO)), balance_usd_micro: z.string() })
  .parse(await credited.json());
assert.equal((await deposit()).status, 409);
console.log(`credited   ${funded} micro USD; the replay was refused`);

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
  body: JSON.stringify({ model: MODEL, max_tokens: 64, messages: [{ role: "user", content: "Answer in one word: ready?" }] }),
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
assert.equal(BigInt(after.balance_usd_micro), BigInt(funded) - cost);
console.log(`balance    ${after.balance_usd_micro} micro USD; the call spent prepaid tokens, not cash`);
