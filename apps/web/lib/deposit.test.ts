import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { POST } from "../app/api/v1/keys/deposit/route.ts";
import { db } from "./db.ts";
import { balanceOf } from "./ledger.ts";
import { keys } from "./schema.ts";
import { cleanup, first, hasDb, makeKey, skip } from "./testkit.ts";
import type { DepositResult } from "./types";

const TREASURY = "0.0.5176";
const USDC = "0.0.429274";
const PAYER = "0.0.1234";

let mirror: ReturnType<typeof createServer> | null = null;
let tx: { result: string; memo: string; token_id: string; account: string; amount: number } = {
  result: "SUCCESS",
  memo: "",
  token_id: USDC,
  account: TREASURY,
  amount: 500_000,
};

before(async () => {
  if (!hasDb) return;
  mirror = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (!request.url?.startsWith("/api/v1/transactions/")) {
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
  if (hasDb) await cleanup();
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
