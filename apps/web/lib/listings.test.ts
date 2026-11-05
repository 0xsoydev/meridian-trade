import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { DELETE, PATCH } from "../app/api/listings/[id]/route.ts";
import { GET, POST } from "../app/api/listings/route.ts";
import { POST as verifySeller } from "../app/api/sellers/verify/route.ts";
import { db } from "./db.ts";
import { listingPriceError, parseCapacityMtok } from "./listings.ts";
import { listings, sellers } from "./schema.ts";
import { open } from "./secrets.ts";
import { cleanup, hasDb, makeSeller, reply, skip, status, stubRail, suffix, type ChatCall } from "./testkit.ts";
import type { SellerListings } from "./types";

const own = { prompt: 1_400_000n, completion: 4_400_000n };
const MODEL = `t-${suffix}-listing`;
const SECOND_MODEL = `t-${suffix}-second`;
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
  rail = await stubRail([MODEL, PROBE_MODEL, SECOND_MODEL], (call, response) => {
    if (call.body.model === "__probe__") {
      status(response, call.auth === "Bearer sk-bad" ? 401 : 404);
      return;
    }
    if (call.auth === "Bearer sk-bad") {
      status(response, 401);
      return;
    }
    reply(response, `chatcmpl-${suffix}-listing`);
  });
  process.env.COMMANDCODE_BASE_URL = process.env.STUB_RAIL_URL;
  sellerId = await makeSeller();
  await db().update(sellers).set({ address: account.address.toLowerCase() }).where(eq(sellers.id, sellerId));
});

after(async () => {
  if (!hasDb) return;
  if (created.length > 0) await db().delete(listings).where(inArray(listings.id, created));
  rail?.close();
  await cleanup();
});

async function sign(fields: Record<string, unknown>, signer: PrivateKeyAccount = account): Promise<Envelope> {
  const message = JSON.stringify({ domain: "localhost", action: "list", issued_at: new Date().toISOString(), ...fields });
  return { address: signer.address, message, signature: await signer.signMessage({ message }) };
}

function reuseCall(envelope: Envelope, listingId: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed: envelope, credential: { kind: "stored", listing_id: listingId } }),
    }),
  );
}

async function sellerListings(address: string): Promise<SellerListings> {
  return (await (await GET(new Request(`http://localhost/api/listings?seller=${address}`))).json()) as SellerListings;
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

test("with the World bypass on, a signed wallet becomes a seller once without a World proof", { skip }, async () => {
  process.env.NEXT_PUBLIC_WORLD_BYPASS = "true";
  const wallet = privateKeyToAccount(generatePrivateKey());
  try {
    const message = JSON.stringify({ domain: "localhost", action: "seller", issued_at: new Date().toISOString() });
    const signed = { address: wallet.address, message, signature: await wallet.signMessage({ message }) };
    const call = () =>
      verifySeller(
        new Request("http://localhost/api/sellers/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: wallet.address, signed, idkit: {} }),
        }),
      );
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 409);
  } finally {
    process.env.NEXT_PUBLIC_WORLD_BYPASS = "false";
    await db().delete(sellers).where(eq(sellers.address, wallet.address.toLowerCase()));
  }
});

test("a key whose model list lacks the model cannot list it, and a rejected key cannot list at all", { skip }, async () => {
  const listing = (nonce: string) =>
    sign({ rail: "stub", model: MODEL, capacity_mtok: "1", price_micro_per_mtok: "1000000", client_nonce: `n-${suffix}-${nonce}` });
  const narrow = await createCall(await listing("40"), "sk-narrow");
  assert.equal(narrow.status, 404);
  const rejected = await createCall(await listing("41"), "sk-bad");
  assert.equal(rejected.status, 401);
});

test("a chat-checked rail lists on a 1-token answer for the exact model and refuses a rejected key", { skip }, async () => {
  const listing = (nonce: string) =>
    sign({ rail: "commandcode", model: MODEL, capacity_mtok: "1", price_micro_per_mtok: "1000000", client_nonce: `n-${suffix}-${nonce}` });
  const accepted = await createCall(await listing("42"));
  assert.equal(accepted.status, 200);
  created.push(z.object({ listing_id: z.string() }).parse(await accepted.json()).listing_id);
  const checked = rail?.calls.at(-1);
  assert.equal(checked?.body.model, MODEL);
  assert.equal(checked?.body.max_completion_tokens, 1);

  const rejected = await createCall(await listing("43"), "sk-bad");
  assert.equal(rejected.status, 401);
});

test("a seller lists another model with a key stored on their listing, and no one else can", { skip }, async () => {
  const listed = z.object({ listing_id: z.string() });
  const listing = (model: string, nonce: string, signer?: PrivateKeyAccount) =>
    sign({ rail: "stub", model, capacity_mtok: "2", price_micro_per_mtok: "1000000", client_nonce: `n-${suffix}-${nonce}` }, signer);

  const source = await createCall(await listing(MODEL, "stored-1"), "sk-stored");
  assert.equal(source.status, 200);
  const sourceId = listed.parse(await source.json()).listing_id;
  created.push(sourceId);

  const reused = await reuseCall(await listing(SECOND_MODEL, "stored-2"), sourceId);
  assert.equal(reused.status, 200);
  const reusedId = listed.parse(await reused.json()).listing_id;
  created.push(reusedId);
  const row = await listingRow(reusedId);
  assert.equal(row?.model, SECOND_MODEL);
  assert.equal(open(row?.credentialCiphertext ?? ""), "sk-stored");

  const mine = await sellerListings(account.address);
  assert.equal(mine.verified, true);
  assert.deepEqual(
    mine.listings.filter((entry) => entry.listing_id === sourceId || entry.listing_id === reusedId).map((entry) => entry.model).sort(),
    [MODEL, SECOND_MODEL].sort(),
  );
  assert.ok(mine.listings.every((entry) => !("credential" in entry) && !("credential_ciphertext" in entry)));

  const stranger = privateKeyToAccount(generatePrivateKey());
  await db().update(sellers).set({ address: stranger.address.toLowerCase() }).where(eq(sellers.id, await makeSeller()));
  const borrowed = await reuseCall(await listing(SECOND_MODEL, "stored-3", stranger), sourceId);
  assert.equal(borrowed.status, 404);

  const nobody = await sellerListings(`0x${"ab".repeat(20)}`);
  assert.deepEqual(nobody, { verified: false, listings: [] });
});
