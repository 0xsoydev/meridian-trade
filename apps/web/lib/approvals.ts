import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "./db.ts";
import { approvals, keys, type ApprovalRow } from "./schema.ts";
import { seal } from "./secrets.ts";
import { testNullifier, verifyWorld, worldBypassed } from "./world.ts";
import type { ApprovalStart, ApprovalStatus } from "./types.ts";

const TTL_MS = 600_000;
const INTERVAL_S = 3;
const STATUSES = ["pending", "approved", "denied", "expired"] as const;

export function approvalAction(): string {
  return process.env.WORLD_APPROVAL_ACTION ?? "seller";
}

function approvalStatus(value: string): ApprovalStatus["status"] {
  return STATUSES.find((status) => status === value) ?? "expired";
}

function pageUrl(id: string): string {
  const base = process.env.PUBLIC_HOST ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/approve/${id}`;
}

function startOf(row: ApprovalRow): ApprovalStart {
  return {
    approval_id: row.id,
    user_code: row.userCode,
    verification_uri_complete: row.verificationUriComplete,
    expires_at: row.expiresAt.toISOString(),
  };
}

async function expire(row: ApprovalRow): Promise<ApprovalRow> {
  if (row.status === "pending" && row.expiresAt.getTime() <= Date.now()) {
    await db()
      .update(approvals)
      .set({ status: "expired" })
      .where(and(eq(approvals.id, row.id), eq(approvals.status, "pending")));
    return { ...row, status: "expired" };
  }
  return row;
}

export async function startApproval(
  keyId: string,
  kind: "link_human" | "raise_cap",
  capMicro: bigint | null,
): Promise<ApprovalStart> {
  if (kind === "raise_cap" && capMicro !== null) {
    const [existing] = await db()
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.keyId, keyId),
          eq(approvals.kind, kind),
          eq(approvals.capUsdMicro, capMicro),
          eq(approvals.status, "pending"),
          gt(approvals.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(approvals.createdAt))
      .limit(1);
    if (existing) return startOf(existing);
  }

  const id = randomUUID();
  const userCode = randomBytes(3).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db().insert(approvals).values({
    id,
    keyId,
    kind,
    capUsdMicro: capMicro,
    deviceCodeCiphertext: seal(randomBytes(16).toString("hex")),
    userCode,
    verificationUriComplete: pageUrl(id),
    intervalS: INTERVAL_S,
    expiresAt,
    status: "pending",
  });
  return {
    approval_id: id,
    user_code: userCode,
    verification_uri_complete: pageUrl(id),
    expires_at: expiresAt.toISOString(),
  };
}

export async function pendingApproval(id: string): Promise<ApprovalRow | null> {
  const [row] = await db().select().from(approvals).where(eq(approvals.id, id)).limit(1);
  if (!row || row.status !== "pending" || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export async function pollApproval(keyId: string, id: string): Promise<ApprovalStatus | null> {
  const [found] = await db()
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.keyId, keyId)))
    .limit(1);
  if (!found) return null;
  const row = await expire(found);
  return { status: approvalStatus(row.status) };
}

export type ApprovalOutcome = { approved: true } | { approved: false; httpStatus: number; error: string };

export async function approveWithProof(id: string, idkit: unknown): Promise<ApprovalOutcome> {
  const [found] = await db()
    .select()
    .from(approvals)
    .where(eq(approvals.id, id))
    .limit(1);
  if (!found) return { approved: false, httpStatus: 404, error: "approval not found" };

  const keyId = found.keyId;
  const row = await expire(found);
  if (row.status !== "pending") return { approved: false, httpStatus: 409, error: `approval is ${row.status}` };

  const [key] = await db().select().from(keys).where(eq(keys.id, keyId)).limit(1);
  if (!key) return { approved: false, httpStatus: 401, error: "invalid router key" };

  const checked = worldBypassed()
    ? { worldNullifier: key.worldSub ?? testNullifier(keyId) }
    : await verifyWorld(idkit, { action: approvalAction(), signal: row.id });
  if ("error" in checked) return { approved: false, httpStatus: 400, error: checked.error };

  if (row.kind === "link_human") {
    if (key.worldSub !== null && key.worldSub !== checked.worldNullifier) {
      return { approved: false, httpStatus: 403, error: "this key is already linked to a human" };
    }
    await db().update(keys).set({ worldSub: checked.worldNullifier }).where(eq(keys.id, keyId));
  } else {
    if (key.worldSub === null) {
      return { approved: false, httpStatus: 403, error: "link a human to this key first" };
    }
    if (key.worldSub !== checked.worldNullifier) {
      return { approved: false, httpStatus: 403, error: "only the linked human may raise the cap" };
    }
    if (row.capUsdMicro === null) return { approved: false, httpStatus: 400, error: "approval has no cap" };
    await db().update(keys).set({ dailyTopupCapUsdMicro: row.capUsdMicro }).where(eq(keys.id, keyId));
  }

  await db()
    .update(approvals)
    .set({ status: "approved" })
    .where(and(eq(approvals.id, id), eq(approvals.keyId, keyId), eq(approvals.status, "pending")));
  return { approved: true };
}

export async function denyApproval(id: string): Promise<boolean> {
  const [found] = await db().select().from(approvals).where(eq(approvals.id, id)).limit(1);
  if (!found) return false;
  const row = await expire(found);
  if (row.status !== "pending") return false;
  const [updated] = await db()
    .update(approvals)
    .set({ status: "denied" })
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  return updated !== undefined;
}
