import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { POST } from "../app/api/v1/keys/deposit/route.ts";
import { createKey, ensureAccount } from "./accounts.ts";
import { db } from "./db.ts";
import { balanceOf } from "./ledger.ts";
import { evmAddressOf } from "./mirror.ts";
import { accounts, keys, topups } from "./schema.ts";
import { adoptKey, cleanup, first, hasDb, makeKey, skip } from "./testkit.ts";
import type { DepositResult } from "./types";

const TREASURY = "0.0.5176";
const USDC = "0.0.429274";
const PAYER = "0.0.1234";
const TREASURY_EVM = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const USDC_EVM = "0x0000000000000000000000000000000000068cda";
const PAYER_EVM = "0x00000000000000000000000000000000000004d2";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

let mirror: ReturnType<typeof createServer> | null = null;
let tx: { result: string; memo: string; token_id: string; account: string; amount: number } = {
  result: "SUCCESS",
  memo: "",
  token_id: USDC,
  account: TREASURY,
  amount: 500_000,
};
const results = new Map<string, unknown>();
const accountIds: string[] = [];

before(async () => {
  if (!hasDb) return;
  mirror = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const url = request.url ?? "";
      if (url.startsWith(`/api/v1/accounts/${TREASURY}?`)) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ account: TREASURY, evm_address: TREASURY_EVM }));
        return;
      }
      if (url.startsWith("/api/v1/contracts/results/")) {
        const result = results.get(url.slice("/api/v1/contracts/results/".length).toLowerCase());
        response.writeHead(result ? 200 : 404, { "content-type": "application/json" });
        response.end(JSON.stringify(result ?? {}));
        return;
      }
      if (!url.startsWith("/api/v1/transactions/")) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          transactions: [
            {
              result: tx.result,
              memo_base64: tx.memo,
              token_transfers: [
                { token_id: tx.token_id, account: tx.account, amount: tx.amount },
                { token_id: tx.token_id, account: PAYER, amount: -tx.amount },
              ],
            },
          ],
        }),
      );
    });
  });
  mirror.listen(0, "127.0.0.1");
  await once(mirror, "listening");
  const address = mirror.address();
  process.env.MIRROR_NODE_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.HEDERA_TREASURY_ID = TREASURY;
  process.env.HEDERA_USDC = USDC;
});

after(async () => {
  mirror?.closeAllConnections();
  mirror?.close();
  if (!hasDb) return;
  await cleanup();
  if (accountIds.length > 0) await db().delete(accounts).where(inArray(accounts.id, accountIds));
});

function deposit(key: string, txId: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/keys/deposit", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ tx_id: txId }),
    }),
  );
}

async function message(response: Response): Promise<string> {
  return ((await response.json()) as { error: { message: string } }).error.message;
}

async function walletKey(): Promise<{ id: string; raw: string; wallet: string }> {
  const wallet = `0x${randomBytes(20).toString("hex")}`;
  const account = await ensureAccount(wallet, null);
  if (!("id" in account)) throw new Error("account conflict");
  accountIds.push(account.id);
  const key = await createKey(account.id);
  adoptKey(key.id);
  return { ...key, wallet };
}

const word = (hex: string) => `0x${hex.replace(/^0x/, "").padStart(64, "0")}`;

function transfer(from: string, to: string, amount: bigint) {
  return { address: USDC_EVM, topics: [TRANSFER, word(from), word(to)], data: word(amount.toString(16)) };
}

function paid(logs: unknown[], fields: { result?: string; hash?: string } = {}): string {
  const hash = `0x${randomBytes(32).toString("hex")}`;
  results.set(hash, { hash: fields.hash ?? hash, result: fields.result ?? "SUCCESS", from: PAYER_EVM, logs });
  return hash;
}

const TX_ID = "0.0.1234@1700000000.000000001";

test("a USDC transfer with the key memo is credited exactly once", { skip }, async () => {
  const key = await makeKey(0n);
  tx = { result: "SUCCESS", memo: Buffer.from(key.id).toString("base64"), token_id: USDC, account: TREASURY, amount: 500_000 };

  const response = await deposit(key.raw, TX_ID);
  assert.equal(response.status, 200);
  const result = (await response.json()) as DepositResult;
  assert.equal(result.tx_id, "0.0.1234-1700000000-000000001");
  assert.equal(result.amount_usd_micro, "500000");
  assert.equal(result.balance_usd_micro, "500000");
  assert.equal((await balanceOf(key.id))?.memo, key.id);

  const replay = await deposit(key.raw, TX_ID);
  assert.equal(replay.status, 409);
  assert.equal(first(await db().select().from(keys).where(eq(keys.id, key.id))).balanceUsdMicro, 500_000n);
});

test("a memo for another key is refused", { skip }, async () => {
  const key = await makeKey(0n);
  tx = { result: "SUCCESS", memo: Buffer.from("another-key").toString("base64"), token_id: USDC, account: TREASURY, amount: 100_000 };
  const response = await deposit(key.raw, "0.0.1234@1700000001.000000001");
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: { message: string } }).error.message, /memo/);
});

test("a transfer of the wrong token is refused", { skip }, async () => {
  const key = await makeKey(0n);
  tx = { result: "SUCCESS", memo: Buffer.from(key.id).toString("base64"), token_id: "0.0.999", account: TREASURY, amount: 100_000 };
  const response = await deposit(key.raw, "0.0.1234@1700000002.000000001");
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: { message: string } }).error.message, /USDC/);
});

test("a failed transaction is refused", { skip }, async () => {
  const key = await makeKey(0n);
  tx = { result: "INSUFFICIENT_TOKEN_BALANCE", memo: Buffer.from(key.id).toString("base64"), token_id: USDC, account: TREASURY, amount: 100_000 };
  const response = await deposit(key.raw, "0.0.1234@1700000003.000000001");
  assert.equal(response.status, 400);
});

test("a malformed transaction id is refused", { skip }, async () => {
  const key = await makeKey(0n);
  const response = await deposit(key.raw, "not-a-transaction");
  assert.equal(response.status, 400);
});

test("entity ids map to the long-zero EVM addresses the mirror reports", () => {
  assert.equal(evmAddressOf("0.0.11223929"), "0x0000000000000000000000000000000000ab4379");
  assert.equal(evmAddressOf(USDC), USDC_EVM);
  assert.equal(evmAddressOf("0x1234"), null);
});

test("a USDC transfer from the key's wallet to the treasury is credited exactly once", { skip }, async () => {
  const key = await walletKey();
  const view = await balanceOf(key.id);
  assert.equal(view?.wallet, key.wallet);
  assert.equal(view?.treasury_evm, TREASURY_EVM);
  assert.equal(view?.usdc_evm, USDC_EVM);

  const hash = paid([transfer(key.wallet, TREASURY_EVM, 250_000n)]);
  const response = await deposit(key.raw, hash);
  assert.equal(response.status, 200);
  const result = (await response.json()) as DepositResult;
  assert.equal(result.tx_id, hash);
  assert.equal(result.amount_usd_micro, "250000");
  assert.equal(result.balance_usd_micro, "250000");
  assert.equal(first(await db().select().from(topups).where(eq(topups.txId, hash))).payer, PAYER);

  const replay = await deposit(key.raw, `0x${hash.slice(2).toUpperCase()}`);
  assert.equal(replay.status, 409);
  assert.equal(first(await db().select().from(keys).where(eq(keys.id, key.id))).balanceUsdMicro, 250_000n);
});

test("a wallet deposit needs USDC sent from the key's wallet to the treasury", { skip }, async () => {
  const key = await walletKey();
  const other = `0x${randomBytes(20).toString("hex")}`;
  for (const log of [
    transfer(other, TREASURY_EVM, 100_000n),
    transfer(key.wallet, other, 100_000n),
    { ...transfer(key.wallet, TREASURY_EVM, 100_000n), address: other },
  ]) {
    const response = await deposit(key.raw, paid([log]));
    assert.equal(response.status, 400);
    assert.match(await message(response), /no USDC transfer/);
  }
  assert.equal(first(await db().select().from(keys).where(eq(keys.id, key.id))).balanceUsdMicro, 0n);
});

test("a reverted transfer, or a hash the mirror maps to another transaction, is refused", { skip }, async () => {
  const key = await walletKey();
  const log = transfer(key.wallet, TREASURY_EVM, 100_000n);

  const reverted = await deposit(key.raw, paid([log], { result: "CONTRACT_REVERT_EXECUTED" }));
  assert.equal(reverted.status, 400);
  assert.match(await message(reverted), /CONTRACT_REVERT_EXECUTED/);

  const aliased = await deposit(key.raw, paid([log], { hash: `0x${randomBytes(32).toString("hex")}` }));
  assert.equal(aliased.status, 400);
  assert.match(await message(aliased), /another transaction/);
});

test("a wallet transfer above the deposit cap is refused", { skip }, async () => {
  const key = await walletKey();
  const response = await deposit(key.raw, paid([transfer(key.wallet, TREASURY_EVM, 20_000_001n)]));
  assert.equal(response.status, 400);
  assert.match(await message(response), /at most/);
});

test("a key without a wallet cannot claim a wallet transfer", { skip }, async () => {
  const key = await makeKey(0n);
  const response = await deposit(key.raw, paid([transfer(PAYER_EVM, TREASURY_EVM, 100_000n)]));
  assert.equal(response.status, 400);
  assert.match(await message(response), /no wallet/);
});

test("a hash the mirror has not indexed yet asks for a retry", { skip }, async () => {
  const key = await walletKey();
  const response = await deposit(key.raw, `0x${randomBytes(32).toString("hex")}`);
  assert.equal(response.status, 400);
  assert.match(await message(response), /not on the mirror yet/);
});
