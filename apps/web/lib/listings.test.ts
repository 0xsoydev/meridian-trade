import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { DELETE, PATCH } from "../app/api/listings/[id]/route.ts";
import { POST } from "../app/api/listings/route.ts";
import { db } from "./db.ts";
import { listingPriceError, parseCapacityMtok } from "./listings.ts";
import { listings, sellers } from "./schema.ts";
import { open } from "./secrets.ts";
import { cleanup, hasDb, makeSeller, reply, skip, status, stubRail, suffix, type ChatCall } from "./testkit.ts";

const own = { prompt: 1_400_000n, completion: 4_400_000n };
const MODEL = `t-${suffix}-listing`;
const PROBE_MODEL = "0gm-1.0-35b-a3b";
const account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());

test("capacity converts mtok to tokens", () => {
  assert.equal(parseCapacityMtok("1"), 1_000_000n);
  assert.equal(parseCapacityMtok("12"), 12_000_000n);
  assert.equal(parseCapacityMtok("9223372036854"), 9_223_372_036_854_000_000n);
});

test("capacity rejects zero, fractions, negatives and overflow", () => {
  assert.equal(parseCapacityMtok("0"), null);
  assert.equal(parseCapacityMtok("1.5"), null);
  assert.equal(parseCapacityMtok("-1"), null);
  assert.equal(parseCapacityMtok("9223372036855"), null);
  assert.equal(parseCapacityMtok(""), null);
});

test("blank price is allowed only on expiring rails", () => {
  assert.equal(listingPriceError(null, own, "daily"), null);
  assert.notEqual(listingPriceError(null, own, null), null);
});

test("price must be positive and at or below the rail list price", () => {
  assert.equal(listingPriceError(2_150_000n, own, "daily"), null);
  assert.equal(listingPriceError(1n, own, "daily"), null);
  assert.notEqual(listingPriceError(0n, own, "daily"), null);
  assert.notEqual(listingPriceError(2_150_001n, own, "daily"), null);
});

type Envelope = { address: string; message: string; signature: string };

let rail: { calls: ChatCall[]; close: () => void } | null = null;
let sellerId = "";
const created: string[] = [];

before(async () => {
  if (!hasDb) return;
  process.env.PUBLIC_HOST = "http://localhost";
  rail = await stubRail([MODEL, PROBE_MODEL], (call, response) => {
    if (call.body.model === "__probe__") {
      status(response, call.auth === "Bearer sk-bad" ? 401 : 404);
      return;
    }
    reply(response, `chatcmpl-${suffix}-listing`);
  });
  sellerId = await makeSeller();
  await db().update(sellers).set({ address: account.address.toLowerCase() }).where(eq(sellers.id, sellerId));
});

after(async () => {
  if (!hasDb) return;
  if (created.length > 0) await db().delete(listings).where(inArray(listings.id, created));
  rail?.close();
  await cleanup();
});

async function sign(fields: Record<string, unknown>): Promise<Envelope> {
  const message = JSON.stringify({ domain: "localhost", action: "list", issued_at: new Date().toISOString(), ...fields });
  return { address: account.address, message, signature: await account.signMessage({ message }) };
}

function createCall(envelope: Envelope, key = "sk-test"): Promise<Response> {
  return POST(
    new Request("http://localhost/api/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed: envelope, credential: { kind: "key", key } }),
    }),
  );
}

function amendCall(id: string, envelope: Envelope): Promise<Response> {
  return PATCH(
    new Request(`http://localhost/api/listings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed: envelope }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function cancelCall(id: string, envelope: Envelope): Promise<Response> {
  return DELETE(
    new Request(`http://localhost/api/listings/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed: envelope }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const listingRow = async (id: string) => {
  const [row] = await db().select().from(listings).where(eq(listings.id, id)).limit(1);
  return row;
};

test("a signed listing is stored sealed and active", { skip }, async () => {
  const response = await createCall(
    await sign({
      rail: "stub",
      model: MODEL,
      capacity_mtok: "10",
      price_micro_per_mtok: "2000000",
      client_nonce: `n-${suffix}-1`,
    }),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { listing_id: string; capacity_tokens: string; status: string };
  created.push(body.listing_id);
  assert.equal(body.capacity_tokens, "10000000");
  assert.equal(body.status, "active");

  const row = await listingRow(body.listing_id);
  assert.ok(row);
  assert.equal(row.priceMicroPerMtok, 2_000_000n);
  assert.equal(row.capacityTokens, 10_000_000n);
  assert.equal(row.sellerId, sellerId);
  assert.equal(open(row.credentialCiphertext), "sk-test");
});

test("the 0g credential probe accepts model_not_found and rejects a bad key", { skip }, async () => {
  const accepted = await createCall(
    await sign({
      rail: "0g",
      model: PROBE_MODEL,
      capacity_mtok: "1",
      price_micro_per_mtok: "2000000",
      client_nonce: `n-${suffix}-12`,
    }),
  );
  assert.equal(accepted.status, 200);
  const body = (await accepted.json()) as { listing_id: string; status: string };
  created.push(body.listing_id);
  assert.equal(body.status, "active");

  const rejected = await createCall(
    await sign({
      rail: "0g",
      model: PROBE_MODEL,
      capacity_mtok: "1",
      price_micro_per_mtok: "2000000",
      client_nonce: `n-${suffix}-13`,
    }),
    "sk-bad",
  );
  assert.equal(rejected.status, 401);
});

test("a price at or above the list price is refused", { skip }, async () => {
  const response = await createCall(
    await sign({
      rail: "stub",
      model: MODEL,
      capacity_mtok: "10",
      price_micro_per_mtok: "2150001",
      client_nonce: `n-${suffix}-2`,
    }),
  );
  assert.equal(response.status, 400);
});

test("a replayed client_nonce is refused", { skip }, async () => {
  const response = await createCall(
    await sign({
      rail: "stub",
      model: MODEL,
      capacity_mtok: "10",
      price_micro_per_mtok: "2000000",
      client_nonce: `n-${suffix}-1`,
    }),
  );
  assert.equal(response.status, 409);
});

test("amend re-prices and cannot cut below committed tokens", { skip }, async () => {
  const id = created[0];
  assert.ok(id);

  const amended = await amendCall(
    id,
    await sign({
      action: "amend",
      listing_id: id,
      price_micro_per_mtok: "2100000",
      capacity_mtok: "20",
      client_nonce: `n-${suffix}-3`,
    }),
  );
  assert.equal(amended.status, 200);
  const afterAmend = await listingRow(id);
  assert.equal(afterAmend?.priceMicroPerMtok, 2_100_000n);
  assert.equal(afterAmend?.capacityTokens, 20_000_000n);

  await db().update(listings).set({ usedTokens: 19_000_000n }).where(eq(listings.id, id));

  const tooSmall = await amendCall(
    id,
    await sign({
      action: "amend",
      listing_id: id,
      price_micro_per_mtok: "2100000",
      capacity_mtok: "15",
      client_nonce: `n-${suffix}-4`,
    }),
  );
  assert.equal(tooSmall.status, 409);

  const atFloor = await amendCall(
    id,
    await sign({
      action: "amend",
      listing_id: id,
      price_micro_per_mtok: "2100000",
      capacity_mtok: "19",
      client_nonce: `n-${suffix}-5`,
    }),
  );
  assert.equal(atFloor.status, 200);
  assert.equal((await listingRow(id))?.capacityTokens, 19_000_000n);
});

test("an amend that reuses another listing's nonce is refused", { skip }, async () => {
  const id = created[0];
  assert.ok(id);

  const other = await createCall(
    await sign({
      rail: "stub",
      model: MODEL,
      capacity_mtok: "10",
      price_micro_per_mtok: "2000000",
      client_nonce: `n-${suffix}-11`,
    }),
  );
  assert.equal(other.status, 200);
  const second = (await other.json()) as { listing_id: string };
  created.push(second.listing_id);

  const response = await amendCall(
    id,
    await sign({
      action: "amend",
      listing_id: id,
      price_micro_per_mtok: "2100000",
      capacity_mtok: "19",
      client_nonce: `n-${suffix}-11`,
    }),
  );
  assert.equal(response.status, 409);
});

test("raising capacity revives an exhausted listing, the floor does not", { skip }, async () => {
  const id = created[0];
  assert.ok(id);

  await db().update(listings).set({ status: "exhausted" }).where(eq(listings.id, id));

  const atFloor = await amendCall(
    id,
    await sign({
      action: "amend",
      listing_id: id,
      price_micro_per_mtok: "2100000",
      capacity_mtok: "19",
      client_nonce: `n-${suffix}-9`,
    }),
  );
  assert.equal(atFloor.status, 200);
  assert.equal((await listingRow(id))?.status, "exhausted");

  const raised = await amendCall(
    id,
    await sign({
      action: "amend",
      listing_id: id,
      price_micro_per_mtok: "2100000",
      capacity_mtok: "25",
      client_nonce: `n-${suffix}-10`,
    }),
  );
  assert.equal(raised.status, 200);
  assert.equal((await listingRow(id))?.status, "active");
  assert.equal((await listingRow(id))?.capacityTokens, 25_000_000n);
});

test("cancel refuses an open reservation and then cancels once", { skip }, async () => {
  const id = created[0];
  assert.ok(id);

  await db().update(listings).set({ usedTokens: 18_000_000n, reservedTokens: 1n }).where(eq(listings.id, id));
  const blocked = await cancelCall(
    id,
    await sign({ action: "cancel", listing_id: id, client_nonce: `n-${suffix}-6` }),
  );
  assert.equal(blocked.status, 409);

  await db().update(listings).set({ reservedTokens: 0n }).where(eq(listings.id, id));
  const cancelled = await cancelCall(
    id,
    await sign({ action: "cancel", listing_id: id, client_nonce: `n-${suffix}-7` }),
  );
  assert.equal(cancelled.status, 200);
  assert.equal((await listingRow(id))?.status, "cancelled");

  const again = await cancelCall(
    id,
    await sign({ action: "cancel", listing_id: id, client_nonce: `n-${suffix}-8` }),
  );
  assert.equal(again.status, 409);
});
