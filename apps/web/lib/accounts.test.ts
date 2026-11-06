import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { DELETE, GET, POST } from "../app/api/v1/keys/route.ts";
import { approvalAction } from "./approvals.ts";
import { db } from "./db.ts";
import { accounts, keys } from "./schema.ts";
import { cleanup, hasDb, skip } from "./testkit.ts";
import type { CreateKeyResult, KeySummary } from "./types";
import { signalHash } from "./world.ts";

const addresses: string[] = [];
let verifier: ReturnType<typeof createServer> | null = null;
let nullifier = "42";

before(async () => {
  if (!hasDb) return;
  process.env.PUBLIC_HOST = "http://localhost";
  verifier = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, nullifier, action: approvalAction() }));
    });
  });
  verifier.listen(0, "127.0.0.1");
  await once(verifier, "listening");
  const address = verifier.address();
  process.env.WORLD_RP_ID = "rp_test";
  process.env.WORLD_VERIFY_URL = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/verify`;
});

after(async () => {
  verifier?.closeAllConnections();
  verifier?.close();
  if (!hasDb) return;
  for (const address of addresses) {
    const [account] = await db().select().from(accounts).where(eq(accounts.address, address)).limit(1);
    if (!account) continue;
    await db().delete(keys).where(eq(keys.accountId, account.id));
    await db().delete(accounts).where(eq(accounts.id, account.id));
  }
  await cleanup();
});

type Envelope = { address: string; message: string; signature: string };

async function sign(account: PrivateKeyAccount, action: string, fields: Record<string, unknown> = {}): Promise<Envelope> {
  const message = JSON.stringify({ domain: "localhost", action, issued_at: new Date().toISOString(), ...fields });
  return { address: account.address, message, signature: await account.signMessage({ message }) };
}

function createKeyCall(envelope: Envelope, world?: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(world === undefined ? envelope : { ...envelope, world }),
    }),
  );
}

function listCall(envelope: Envelope): Promise<Response> {
  const query = new URLSearchParams(envelope).toString();
  return GET(new Request(`http://localhost/api/v1/keys?${query}`));
}

function proofFor(account: PrivateKeyAccount): { responses: Array<{ signal_hash: string }> } {
  return { responses: [{ signal_hash: signalHash(account.address.toLowerCase()) }] };
}

test("a wallet signature creates a key bound to the account", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  addresses.push(account.address.toLowerCase());

  const response = await createKeyCall(await sign(account, "create_key"));
  assert.equal(response.status, 200);
  const result = (await response.json()) as CreateKeyResult;
  assert.match(result.key, /^rk_/);

  const [row] = await db().select().from(accounts).where(eq(accounts.address, account.address.toLowerCase())).limit(1);
  assert.ok(row);
  const key = (await db().select().from(keys).where(eq(keys.id, result.key_id)).limit(1))[0];
  assert.ok(key);
  assert.equal(key.accountId, row.id);
  assert.equal(key.balanceUsdMicro, 0n);

  const listed = await listCall(await sign(account, "list_keys"));
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as { keys: KeySummary[] };
  assert.equal(body.keys.length, 1);
  assert.equal(body.keys[0]?.key_id, result.key_id);
  assert.equal(body.keys[0]?.balance_usd_micro, "0");
});

test("a key deletes itself only once it holds nothing, then stops working", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  addresses.push(account.address.toLowerCase());
  const created = (await (await createKeyCall(await sign(account, "create_key"))).json()) as CreateKeyResult;
  const remove = () =>
    DELETE(new Request("http://localhost/api/v1/keys", { method: "DELETE", headers: { authorization: `Bearer ${created.key}` } }));

  await db().update(keys).set({ balanceUsdMicro: 1n }).where(eq(keys.id, created.key_id));
  assert.equal((await remove()).status, 409);

  await db().update(keys).set({ balanceUsdMicro: 0n }).where(eq(keys.id, created.key_id));
  assert.equal((await remove()).status, 204);
  assert.equal((await remove()).status, 401);
});

test("a tampered signature is refused", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const envelope = await sign(account, "create_key");
  const last = envelope.signature.at(-1) === "a" ? "b" : "a";
  const response = await createKeyCall({ ...envelope, signature: envelope.signature.slice(0, -1) + last });
  assert.equal(response.status, 401);
});

test("a stale signature is refused", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = JSON.stringify({ domain: "localhost", action: "create_key", issued_at: new Date(Date.now() - 600_000).toISOString() });
  const response = await createKeyCall({ address: account.address, message, signature: await account.signMessage({ message }) });
  assert.equal(response.status, 401);
});

test("a signature for another action or host is refused", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  assert.equal((await createKeyCall(await sign(account, "list_keys"))).status, 401);
  const wrongHost = JSON.stringify({ domain: "evil.example", action: "create_key", issued_at: new Date().toISOString() });
  const response = await createKeyCall({
    address: account.address,
    message: wrongHost,
    signature: await account.signMessage({ message: wrongHost }),
  });
  assert.equal(response.status, 401);
});

test("one human cannot open a second account", { skip }, async () => {
  nullifier = "987654321";
  const first = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  addresses.push(first.address.toLowerCase());

  const created = await createKeyCall(await sign(first, "create_key"), proofFor(first));
  assert.equal(created.status, 200);

  const clash = await createKeyCall(await sign(second, "create_key"), proofFor(second));
  assert.equal(clash.status, 409);
  const none = await db().select().from(accounts).where(eq(accounts.address, second.address.toLowerCase()));
  assert.equal(none.length, 0);
});

test("a World proof bound to another wallet is refused", { skip }, async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const response = await createKeyCall(await sign(signer, "create_key"), proofFor(privateKeyToAccount(generatePrivateKey())));
  assert.equal(response.status, 400);
});
