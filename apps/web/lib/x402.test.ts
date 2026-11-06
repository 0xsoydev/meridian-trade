import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { PrivateKey, createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { eq } from "drizzle-orm";
import { GET as balance } from "../app/api/v1/balance/route.ts";
import { POST as chat } from "../app/api/v1/chat/completions/route.ts";
import { PATCH as settings } from "../app/api/v1/keys/settings/route.ts";
import { GET as models } from "../app/api/v1/models/route.ts";
import { POST as topup } from "../app/api/v1/topup/route.ts";
import { db } from "./db.ts";
import { createFundedKey, credit } from "./ledger.ts";
import { keys, topups, usage } from "./schema.ts";
import {
  adoptKey,
  chunks,
  cleanup,
  first,
  hasDb,
  jsonRequest,
  makeKey,
  makeListing,
  makeSeller,
  skip,
  sse,
  stubRail,
  suffix,
  type ChatCall,
} from "./testkit.ts";
import type { Balance, ModelRow, RouterError, TopupResult } from "./types";

const FEE_PAYER = "0.0.9185802";
const TREASURY = "0.0.5176";
const USDC = "0.0.429274";
const MODEL = `t-${suffix}-x402`;
const ping = [{ role: "user", content: "ping" }];

let settled = 0;
const facilitator = createServer(async (request, response) => {
  for await (const _chunk of request);
  const send = (body: unknown) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.url === "/supported") {
    return send({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: FEE_PAYER } }], extensions: [], signers: {} });
  }
  if (request.url === "/verify") return send({ isValid: true, payer: "0.0.1234" });
  if (request.url === "/settle") {
    settled += 1;
    return send({
      success: true,
      transaction: `${FEE_PAYER}@${Date.now()}.${String(settled).padStart(9, "0")}`,
      network: "hedera:testnet",
      payer: "0.0.1234",
    });
  }
  response.writeHead(404).end();
});

let rail: { calls: ChatCall[]; close: () => void } | null = null;
const signatures: string[] = [];

const route = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = new Request(input, init);
  const signature = request.headers.get("payment-signature");
  if (signature) signatures.push(signature);
  const path = new URL(request.url).pathname;
  if (path === "/api/v1/topup") return topup(request);
  if (path === "/api/v1/chat/completions") return chat(request);
  return new Response("not found", { status: 404 });
};

const pay = wrapFetchWithPayment(
  route,
  new x402Client().register(
    "hedera:testnet",
    new ExactHederaScheme(createClientHederaSigner("0.0.1234", PrivateKey.generateECDSA(), { network: "hedera:testnet" })),
  ),
);

before(async () => {
  facilitator.listen(0, "127.0.0.1");
  await once(facilitator, "listening");
  const address = facilitator.address();
  process.env.X402_FACILITATOR_URLS = `http://127.0.0.1:1,http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.HEDERA_TREASURY_ID = TREASURY;
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.HEDERA_USDC = USDC;
  if (!hasDb) return;
  rail = await stubRail([MODEL], (call, response) => {
    void sse(response, chunks(`chatcmpl-${suffix}-${call.body.stream === true ? "s" : "j"}`, ["po", "ng"], { prompt_tokens: 10, completion_tokens: 5 }));
  });
  await makeListing({ sellerId: await makeSeller(), model: MODEL, credential: "sk-ok", price: 1_500_000n, capacity: 1_000_000n });
});

after(async () => {
  facilitator.closeAllConnections();
  facilitator.close();
  rail?.close();
  if (hasDb) await cleanup();
});

const keyRow = async (id: string) => first(await db().select().from(keys).where(eq(keys.id, id)));
const errorCode = async (response: Response) => ((await response.json()) as RouterError).error.code;

test("an unpaid top-up skips an unreachable facilitator and offers USDC payable to the treasury", { skip }, async () => {
  const response = await topup(new Request("http://localhost/api/v1/topup?usd=0.50", { method: "POST" }));
  assert.equal(response.status, 402);
  const offer = decodePaymentRequiredHeader(response.headers.get("payment-required") ?? "");
  const accepted = offer.accepts[0];
  assert.equal(accepted?.network, "hedera:testnet");
  assert.equal(accepted?.asset, USDC);
  assert.equal(accepted?.amount, "500000");
  assert.equal(accepted?.payTo, TREASURY);
  assert.equal(accepted?.extra.feePayer, FEE_PAYER);
  assert.equal(await errorCode(response), "insufficient_balance");
});

test("a paid top-up without a key creates one and funds it", { skip }, async () => {
  const response = await pay("http://localhost/api/v1/topup?usd=0.50", { method: "POST" });
  assert.equal(response.status, 200);
  const result = (await response.json()) as TopupResult;
  adoptKey(result.key_id);
  assert.match(result.key ?? "", /^rk_/);
  assert.equal(result.balance_usd_micro, "500000");
  assert.equal(decodePaymentResponseHeader(response.headers.get("payment-response") ?? "").success, true);

  const view = await balance(new Request("http://localhost/api/v1/balance", { headers: { authorization: `Bearer ${result.key}` } }));
  const state = (await view.json()) as Balance;
  assert.equal(state.balance_usd_micro, "500000");
  assert.equal(state.topped_up_today_usd_micro, "500000");
  assert.equal(state.human_linked, false);
});

test("a paid top-up credits an existing key, and a replay credits nothing", { skip }, async () => {
  const key = await makeKey(100n);
  const response = await pay("http://localhost/api/v1/topup?usd=0.50", {
    method: "POST",
    headers: { authorization: `Bearer ${key.raw}` },
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as TopupResult;
  assert.equal(result.key, undefined);
  assert.equal(result.balance_usd_micro, "500100");

  const replay = { txId: result.tx_id, amountMicro: 500_000n, payer: "0.0.1234" };
  assert.equal(await credit(key.id, replay), null);
  assert.equal(await createFundedKey(replay), null);
  assert.equal((await keyRow(key.id)).balanceUsdMicro, 500_100n);
});

test("a payment that does not match the offer is refused", { skip }, async () => {
  const captured = signatures.at(-1);
  assert.ok(captured);
  const payload = decodePaymentSignatureHeader(captured);
  const send = (header: string) =>
    topup(new Request("http://localhost/api/v1/topup?usd=0.50", { method: "POST", headers: { "payment-signature": header } }));

  const redirected = await send(encodePaymentSignatureHeader({ ...payload, accepted: { ...payload.accepted, payTo: "0.0.666" } }));
  assert.equal(redirected.status, 402);
  assert.match(((await redirected.json()) as RouterError).error.message, /does not match/);

  const oversized = await send(encodePaymentSignatureHeader({ ...payload, accepted: { ...payload.accepted, amount: "25000000" } }));
  assert.equal(oversized.status, 402);
  assert.match(((await oversized.json()) as RouterError).error.message, /between/);
});

test("auto top-up pays the shortfall over x402 and the answer streams", { skip }, async () => {
  const key = await makeKey(0n, { autoTopup: 500_000n });
  const response = await pay("http://localhost/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key.raw}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: ping, max_tokens: 16, stream: true }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"content":"ng"/);
  assert.equal(decodePaymentResponseHeader(response.headers.get("payment-response") ?? "").success, true);

  const row = first(await db().select().from(usage).where(eq(usage.keyId, key.id)));
  assert.equal(row.status, "settled");
  assert.equal(row.chargeUsdMicro, 14n);
  assert.equal((await keyRow(key.id)).balanceUsdMicro, 500_000n - 14n);
  assert.equal(first(await db().select().from(topups).where(eq(topups.keyId, key.id))).amountUsdMicro, 500_000n);
});

test("with auto top-up off the 402 carries no offer", { skip }, async () => {
  const key = await makeKey(0n);
  const response = await chat(jsonRequest("http://localhost/api/v1/chat/completions", key.raw, { model: MODEL, messages: ping, max_tokens: 16 }));
  assert.equal(response.status, 402);
  assert.equal(response.headers.get("payment-required"), null);
  assert.equal(await errorCode(response), "insufficient_balance");
});

test("an auto top-up past the daily cap needs approval", { skip }, async () => {
  const key = await makeKey(0n, { autoTopup: 500_000n, cap: 100_000n });
  const response = await chat(jsonRequest("http://localhost/api/v1/chat/completions", key.raw, { model: MODEL, messages: ping, max_tokens: 16 }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "approval_required");
});

test("settings lower the cap, refuse to raise it, and check the model", { skip }, async () => {
  const key = await makeKey(0n);
  const patch = (body: unknown) => settings(jsonRequest("http://localhost/api/v1/keys/settings", key.raw, body, "PATCH"));

  const lowered = await patch({ daily_topup_cap_usd_micro: "1000000", auto_topup_usd_micro: "250000", default_model: MODEL });
  assert.equal(lowered.status, 200);
  const state = (await lowered.json()) as Balance;
  assert.equal(state.daily_topup_cap_usd_micro, "1000000");
  assert.equal(state.auto_topup_usd_micro, "250000");
  assert.equal(state.default_model, MODEL);

  assert.equal((await patch({ daily_topup_cap_usd_micro: "9000000" })).status, 403);
  assert.equal((await patch({ default_model: "no-such-model" })).status, 404);
  assert.equal((await patch({ auto_topup_usd_micro: "25000000" })).status, 400);
  assert.equal((await patch({ surprise: true })).status, 400);
  assert.equal((await keyRow(key.id)).dailyTopupCapUsdMicro, 1_000_000n);
});

test("models lists the stub model with its best ask", { skip }, async () => {
  const response = await models();
  assert.equal(response.status, 200);
  const list = (await response.json()) as { object: string; data: ModelRow[] };
  assert.equal(list.object, "list");
  const row = list.data.find((entry) => entry.id === MODEL);
  assert.ok(row);
  assert.equal(row.object, "model");
  assert.deepEqual(row.rails, ["0g", "stub"]);
  assert.equal(row.best_ask_micro_per_mtok, "1500000");
  assert.equal(row.reference_blended_micro_per_mtok, "2150000");
  assert.equal(row.index_micro_per_mtok, null);
});
