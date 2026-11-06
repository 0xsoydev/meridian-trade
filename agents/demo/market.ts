import { Client, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactHederaScheme, createClientHederaSigner } from "@x402/hedera";
import {
  formatMicroPerMtok,
  formatMtok,
  formatUsd,
  previewFill,
  sellerEarning,
  TOPUP_MAX_MICRO,
  TOPUP_MIN_MICRO,
} from "../../apps/web/lib/price.ts";
import type { Balance, Book, Holding, RouterError, SellResult, TopupResult, TradeResult } from "../../apps/web/lib/types.ts";

const NETWORK = "hedera:testnet";
const ROUTER_URL = (process.env.ROUTER_URL ?? process.env.PUBLIC_HOST ?? "http://localhost:3000").replace(/\/+$/, "");
const MIRROR = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const USDC = process.env.HEDERA_USDC ?? "0.0.429274";
const MODEL = process.env.MODEL ?? "deepseek-v4.1-flash";
const BUY_TOKENS = BigInt(process.env.BUY_TOKENS ?? "1000000");
const PROMPT = "In one sentence, what does a router do?";
const TAKE_BPS = 1000n;
const MIN_HBAR = 100_000_000n;
const FAUCET_HBAR = 10;
const MIN_USDC = 1_000_000n;
const DRIP_USDC = 2_000_000n;

let routerKey: string | null = null;
let pay: typeof fetch = fetch;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function hederaKey(secret: string): PrivateKey {
  const trimmed = secret.replace(/^0x/, "");
  return trimmed.startsWith("302a") || trimmed.startsWith("302e")
    ? PrivateKey.fromStringDer(trimmed)
    : PrivateKey.fromStringECDSA(trimmed);
}

function hashscan(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${txId.replace("@", "-")}`;
}

function say(step: string, text: string): void {
  console.log(`${step.padEnd(14)}${text}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wallet(accountId: string): Promise<{ hbar: bigint; usdc: bigint }> {
  const response = await fetch(`${MIRROR}/api/v1/accounts/${accountId}?transactions=false`);
  if (!response.ok) throw new Error(`the mirror does not know ${accountId}; run pnpm --filter web agent:setup`);
  const body = (await response.json()) as { balance: { balance: number; tokens: { token_id: string; balance: number }[] } };
  const usdc = body.balance.tokens.find((token) => token.token_id === USDC)?.balance ?? 0;
  return { hbar: BigInt(body.balance.balance), usdc: BigInt(usdc) };
}

async function faucetHbar(accountId: string): Promise<void> {
  const pat = process.env.HEDERA_PAT;
  if (!pat) {
    say("faucet", "HEDERA_PAT is not set; skipping the HBAR faucet");
    return;
  }
  const response = await fetch("https://portal.hedera.com/api/disbursement/cli", {
    method: "POST",
    headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" },
    body: JSON.stringify({ address: accountId, amount: FAUCET_HBAR, network: "testnet" }),
  });
  const text = await response.text();
  if (!response.ok) {
    say("faucet", `the HBAR faucet answered ${response.status}: ${text.slice(0, 160)}`);
    return;
  }
  const body = JSON.parse(text) as { amount: number; transactionId: string };
  say("faucet", `${body.amount} HBAR, ${hashscan(body.transactionId)}`);
}

async function dripUsdc(accountId: string, held: bigint): Promise<void> {
  const treasuryId = required("HEDERA_TREASURY_ID");
  if ((await wallet(treasuryId)).usdc >= DRIP_USDC) {
    const client = Client.forTestnet().setOperator(treasuryId, hederaKey(required("HEDERA_TREASURY_KEY")));
    const response = await new TransferTransaction()
      .addTokenTransfer(USDC, treasuryId, -Number(DRIP_USDC))
      .addTokenTransfer(USDC, accountId, Number(DRIP_USDC))
      .execute(client);
    await response.getReceipt(client);
    client.close();
    say("usdc", `${formatUsd(DRIP_USDC)} from the treasury, ${hashscan(response.transactionId.toString())}`);
    return;
  }
  if (held >= TOPUP_MIN_MICRO) {
    say("usdc", `the treasury is short; carrying on with ${formatUsd(held)}`);
    return;
  }
  say("usdc", `the treasury is short; send USDC to ${accountId} at https://faucet.circle.com (Hedera testnet)`);
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(10_000);
    const now = (await wallet(accountId)).usdc;
    if (now >= TOPUP_MIN_MICRO) {
      say("usdc", `${formatUsd(now)} arrived`);
      return;
    }
  }
  throw new Error(`${accountId} still holds under ${formatUsd(TOPUP_MIN_MICRO)} in USDC`);
}

async function fund(accountId: string): Promise<void> {
  const { hbar, usdc } = await wallet(accountId);
  say("wallet", `${accountId} holds ${(Number(hbar) / 1e8).toFixed(2)} HBAR and ${formatUsd(usdc)} in USDC`);
  if (hbar < MIN_HBAR) await faucetHbar(accountId);
  if (usdc < MIN_USDC) await dripUsdc(accountId, usdc);
}

async function api<T>(path: string, init: RequestInit = {}, via: typeof fetch = fetch): Promise<T> {
  const response = await via(`${ROUTER_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(routerKey ? { authorization: `Bearer ${routerKey}` } : {}) },
  });
  const text = await response.text();
  if (response.ok) return JSON.parse(text) as T;
  const code = text.startsWith("{") ? (JSON.parse(text) as Partial<RouterError>).error?.code : undefined;
  throw Object.assign(new Error(`${path.split("?")[0]} answered ${response.status}: ${text.slice(0, 200)}`), { code });
}

async function topUpTo(needed: bigint): Promise<void> {
  const balance = routerKey ? BigInt((await api<Balance>("/api/v1/balance")).balance_usd_micro) : 0n;
  if (balance >= needed) return;
  const gap = ((needed - balance + 9_999n) / 10_000n) * 10_000n;
  const amount = gap < TOPUP_MIN_MICRO ? TOPUP_MIN_MICRO : gap > TOPUP_MAX_MICRO ? TOPUP_MAX_MICRO : gap;
  const result = await api<TopupResult>(`/api/v1/topup?usd=${formatMicroPerMtok(amount)}`, { method: "POST" }, pay);
  if (result.key) routerKey = result.key;
  say("top-up", `${formatUsd(amount)} over x402, balance ${formatUsd(BigInt(result.balance_usd_micro))}, ${hashscan(result.tx_id)}`);
}

async function buy(): Promise<bigint> {
  const book = await api<Book>(`/api/v1/book?model=${encodeURIComponent(MODEL)}`);
  const quote = previewFill(book.asks, BUY_TOKENS, TAKE_BPS);
  if (quote.fillable === 0n) throw new Error(`no asks on ${MODEL}; list some on /sell or set MODEL`);
  say("quote", `${formatMtok(quote.fillable)} MTok of ${MODEL} for ${formatUsd(quote.cost)} at ${formatMicroPerMtok(quote.avg)} USD/MTok`);
  await topUpTo(quote.cost);
  const result = await api<TradeResult>("/api/v1/trades", {
    method: "POST",
    body: JSON.stringify({ model: MODEL, tokens: quote.fillable.toString() }),
  });
  const cost = result.fills.reduce((sum, fill) => sum + BigInt(fill.charge_usd_micro), 0n);
  say("buy", `${formatMtok(BigInt(result.prepaid_tokens))} MTok for ${formatUsd(cost)} in ${result.fills.length} fill(s)`);
  return quote.avg;
}

async function use(): Promise<void> {
  const completion = await api<{ choices: { message: { content: string | null } }[]; usage: { total_tokens: number } }>(
    "/api/v1/chat/completions",
    { method: "POST", body: JSON.stringify({ model: MODEL, max_tokens: 512, messages: [{ role: "user", content: PROMPT }] }) },
    pay,
  );
  say("inference", `${completion.usage.total_tokens} tokens: ${completion.choices[0]?.message.content?.trim() ?? ""}`);
}

async function sell(tokens: bigint, limit?: bigint): Promise<SellResult> {
  const result = await api<SellResult>("/api/v1/sells", {
    method: "POST",
    body: JSON.stringify(
      limit === undefined
        ? { model: MODEL, tokens: tokens.toString() }
        : { model: MODEL, tokens: tokens.toString(), limit_price_micro_per_mtok: limit.toString() },
    ),
  });
  const sold = result.fills.reduce((sum, fill) => sum + BigInt(fill.tokens), 0n);
  const earned = result.fills.reduce((sum, fill) => sum + sellerEarning(BigInt(fill.charge_usd_micro), TAKE_BPS), 0n);
  const listed = result.offers.reduce((sum, offer) => sum + BigInt(offer.tokens), 0n);
  if (sold > 0n) say("sell", `${formatMtok(sold)} MTok into the bids for ${formatUsd(earned)}`);
  if (listed > 0n) say("sell", `${formatMtok(listed)} MTok resting on the book as a resale ask`);
  return result;
}

async function sellRest(paid: bigint): Promise<void> {
  const rows = (await api<{ data: Holding[] }>(`/api/v1/holdings?model=${encodeURIComponent(MODEL)}`)).data;
  let left = rows.reduce((sum, row) => sum + BigInt(row.tokens), 0n);
  say("holding", `${formatMtok(left)} MTok of ${MODEL} left after the answer`);
  if (left === 0n) return;
  try {
    left = BigInt((await sell(left)).holding_tokens);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "no_liquidity") throw error;
    say("sell", `no bids on ${MODEL}`);
  }
  if (left === 0n) return;
  const book = await api<Book>(`/api/v1/book?model=${encodeURIComponent(MODEL)}`);
  const ask = book.asks[0] ? BigInt(book.asks[0].price_micro_per_mtok) : paid;
  say("sell", `listing the rest at the best ask, ${formatMicroPerMtok(ask)} USD/MTok`);
  await sell(left, ask);
}

async function main(): Promise<void> {
  const agentId = required("HEDERA_AGENT_ID");
  const signer = createClientHederaSigner(agentId, hederaKey(required("HEDERA_AGENT_KEY")), { network: NETWORK });
  pay = wrapFetchWithPayment(globalThis.fetch, new x402Client().register(NETWORK, new ExactHederaScheme(signer))) as typeof fetch;

  await fund(agentId);
  const paid = await buy();
  await use();
  await sellRest(paid);
  say("balance", `${formatUsd(BigInt((await api<Balance>("/api/v1/balance")).balance_usd_micro))} left on the router key`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
