import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { GET as getApproval } from "../app/api/v1/approvals/[id]/route.ts";
import { POST as denyApprovalRoute } from "../app/api/v1/approvals/[id]/deny/route.ts";
import { POST as verifyApproval } from "../app/api/v1/approvals/[id]/verify/route.ts";
import { POST as startApprovalRoute } from "../app/api/v1/approvals/route.ts";
import { PATCH as patchSettings } from "../app/api/v1/keys/settings/route.ts";
import { db } from "./db.ts";
import { approvals, keys } from "./schema.ts";
import { cleanup, hasDb, jsonRequest, makeKey, skip } from "./testkit.ts";
import type { ApprovalStart, ApprovalStatus, RouterError } from "./types.ts";
import { signalHash } from "./world.ts";

let verifier: ReturnType<typeof createServer> | null = null;
let nullifier = "111111111";
let verifyAction = "seller";
const keyIds: string[] = [];

before(async () => {
  if (!hasDb) return;
  process.env.PUBLIC_HOST = "http://localhost";
  process.env.WORLD_ENV = "production";
  process.env.WORLD_APPROVAL_ACTION = "seller";
  process.env.WORLD_RP_ID = "rp_test";
  verifier = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, action: verifyAction, environment: "production", nullifier }));
    });
  });
  verifier.listen(0, "127.0.0.1");
  await once(verifier, "listening");
  const address = verifier.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.WORLD_VERIFY_URL = `http://127.0.0.1:${port}/verify`;
});

after(async () => {
  verifier?.closeAllConnections();
  verifier?.close();
  if (!hasDb) return;
  if (keyIds.length > 0) await db().delete(approvals).where(inArray(approvals.keyId, keyIds));
  await cleanup();
});

const proof = (approvalId: string) => ({
  environment: "production",
  responses: [{ signal_hash: signalHash(approvalId) }],
});

function startCall(raw: string, body: unknown = { kind: "link_human" }): Promise<Response> {
  return startApprovalRoute(jsonRequest("http://localhost/api/v1/approvals", raw, body));
}

function getCall(raw: string, id: string): Promise<Response> {
  return getApproval(new Request(`http://localhost/api/v1/approvals/${id}`, { headers: { authorization: `Bearer ${raw}` } }), {
    params: Promise.resolve({ id }),
  });
}

function verifyCall(raw: string, id: string, idkit: unknown): Promise<Response> {
  return verifyApproval(jsonRequest(`http://localhost/api/v1/approvals/${id}/verify`, raw, { idkit }), {
    params: Promise.resolve({ id }),
  });
}

function denyCall(id: string): Promise<Response> {
  return denyApprovalRoute(new Request(`http://localhost/api/v1/approvals/${id}/deny`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

function patchCall(raw: string, cap: string): Promise<Response> {
  return patchSettings(jsonRequest("http://localhost/api/v1/keys/settings", raw, { daily_topup_cap_usd_micro: cap }, "PATCH"));
}

async function newKey(): Promise<{ id: string; raw: string }> {
  const key = await makeKey(0n);
  keyIds.push(key.id);
  return key;
}

async function link(key: { id: string; raw: string }, human: string): Promise<void> {
  nullifier = human;
  const started = await startCall(key.raw);
  assert.equal(started.status, 200);
  const approval = (await started.json()) as ApprovalStart;
  const verified = await verifyCall(key.raw, approval.approval_id, proof(approval.approval_id));
  assert.equal(verified.status, 200);
}

test("a link approval verifies a World proof and binds the key to the human", { skip }, async () => {
  const key = await newKey();
  nullifier = "123456789";

  const started = await startCall(key.raw);
  assert.equal(started.status, 200);
  const approval = (await started.json()) as ApprovalStart;
  assert.match(approval.approval_id, /^[0-9a-f-]{36}$/);
  assert.match(approval.user_code, /^[0-9A-F]{6}$/);
  assert.match(approval.verification_uri_complete, /\/approve\//);

  const pending = await getCall(key.raw, approval.approval_id);
  assert.deepEqual((await pending.json()) as ApprovalStatus, { status: "pending" });

  const verified = await verifyCall(key.raw, approval.approval_id, proof(approval.approval_id));
  assert.equal(verified.status, 200);
  assert.deepEqual((await verified.json()) as ApprovalStatus, { status: "approved" });

  const [row] = await db().select().from(keys).where(eq(keys.id, key.id)).limit(1);
  assert.equal(row?.worldSub, "123456789");
});

test("the linked human can approve a cap raise", { skip }, async () => {
  const key = await newKey();
  await link(key, "222222222");

  const denied = await patchCall(key.raw, "10000000");
  assert.equal(denied.status, 403);
  const body = (await denied.json()) as RouterError;
  assert.ok(body.approval);

  const verified = await verifyCall(key.raw, body.approval.approval_id, proof(body.approval.approval_id));
  assert.equal(verified.status, 200);
  assert.deepEqual((await verified.json()) as ApprovalStatus, { status: "approved" });

  const [row] = await db().select().from(keys).where(eq(keys.id, key.id)).limit(1);
  assert.equal(row?.dailyTopupCapUsdMicro, 10_000_000n);

  const polled = await getCall(key.raw, body.approval.approval_id);
  assert.deepEqual((await polled.json()) as ApprovalStatus, { status: "approved" });
});

test("with the World bypass on, a key links and raises its cap without a World proof", { skip }, async () => {
  process.env.NEXT_PUBLIC_WORLD_BYPASS = "true";
  try {
    const key = await newKey();
    await link(key, "unused");

    const denied = await patchCall(key.raw, "10000000");
    assert.equal(denied.status, 403);
    const body = z.object({ approval: z.object({ approval_id: z.string() }) }).parse(await denied.json());

    const verified = await verifyCall(key.raw, body.approval.approval_id, {});
    assert.equal(verified.status, 200);
    const [row] = await db().select().from(keys).where(eq(keys.id, key.id)).limit(1);
    assert.equal(row?.dailyTopupCapUsdMicro, 10_000_000n);
  } finally {
    process.env.NEXT_PUBLIC_WORLD_BYPASS = "false";
  }
});

test("a cap raise without a linked human starts a link approval, not a raise", { skip }, async () => {
  const key = await newKey();

  const denied = await patchCall(key.raw, "10000000");
  assert.equal(denied.status, 403);
  const body = (await denied.json()) as RouterError;
  assert.ok(body.approval);
  assert.equal(body.approval.user_code.length, 6);

  const [before] = await db().select().from(keys).where(eq(keys.id, key.id)).limit(1);
  assert.equal(before?.dailyTopupCapUsdMicro, 5_000_000n);

  nullifier = "555555555";
  const verified = await verifyCall(key.raw, body.approval.approval_id, proof(body.approval.approval_id));
  assert.equal(verified.status, 200);

  const [afterLink] = await db().select().from(keys).where(eq(keys.id, key.id)).limit(1);
  assert.equal(afterLink?.worldSub, "555555555");
  assert.equal(afterLink?.dailyTopupCapUsdMicro, 5_000_000n);
});

test("a denied approval is refused and cannot be replayed", { skip }, async () => {
  const key = await newKey();
  const started = await startCall(key.raw);
  const approval = (await started.json()) as ApprovalStart;

  const denied = await denyCall(approval.approval_id);
  assert.equal(denied.status, 200);
  assert.deepEqual((await denied.json()) as ApprovalStatus, { status: "denied" });

  const polled = await getCall(key.raw, approval.approval_id);
  assert.deepEqual((await polled.json()) as ApprovalStatus, { status: "denied" });

  const replayed = await verifyCall(key.raw, approval.approval_id, proof(approval.approval_id));
  assert.equal(replayed.status, 409);

  const again = await denyCall(approval.approval_id);
  assert.equal(again.status, 409);
});

test("a proof for another action is refused", { skip }, async () => {
  const key = await newKey();
  const started = await startCall(key.raw);
  const approval = (await started.json()) as ApprovalStart;

  verifyAction = "not-seller";
  const verified = await verifyCall(key.raw, approval.approval_id, proof(approval.approval_id));
  assert.equal(verified.status, 400);
  verifyAction = "seller";
});

test("a different human cannot raise the cap", { skip }, async () => {
  const key = await newKey();
  await link(key, "333333333");

  const denied = await patchCall(key.raw, "10000000");
  assert.equal(denied.status, 403);
  const body = (await denied.json()) as RouterError;
  assert.ok(body.approval);

  nullifier = "444444444";
  const verified = await verifyCall(key.raw, body.approval.approval_id, proof(body.approval.approval_id));
  assert.equal(verified.status, 403);
});

test("a pending approval expires", { skip }, async () => {
  const key = await newKey();
  const [inserted] = await db()
    .insert(approvals)
    .values({
      keyId: key.id,
      kind: "link_human",
      deviceCodeCiphertext: "x",
      userCode: "ABCDEF",
      verificationUriComplete: "http://localhost/approve/expired",
      intervalS: 3,
      expiresAt: new Date(Date.now() - 1000),
      status: "pending",
    })
    .returning({ id: approvals.id });
  assert.ok(inserted);

  const polled = await getCall(key.raw, inserted.id);
  assert.equal(polled.status, 200);
  assert.deepEqual((await polled.json()) as ApprovalStatus, { status: "expired" });
});
