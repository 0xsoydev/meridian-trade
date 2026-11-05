import { eq } from "drizzle-orm";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { z } from "zod";
import { db } from "./db.ts";
import { fail } from "./errors.ts";
import { startApproval } from "./approvals.ts";
import { credit, toppedUpToday, type Payment } from "./ledger.ts";
import { keys, type KeyRow } from "./schema.ts";
import type { RouterError } from "./types";

export const TOPUP_MIN_MICRO = 100_000n;
export const TOPUP_MAX_MICRO = 20_000_000n;

const DEFAULT_FACILITATORS = "https://api.testnet.blocky402.com,https://x402.org/facilitator";
const amountSchema = z.string().regex(/^\d{1,15}$/);

function isNetwork(value: string): value is Network {
  return /^[a-z0-9-]+:[a-z0-9-]+$/.test(value);
}

function network(): Network {
  const value = process.env.HEDERA_NETWORK ?? "hedera:testnet";
  if (!isNetwork(value)) throw new Error("HEDERA_NETWORK must look like hedera:testnet");
  return value;
}

let server: Promise<x402ResourceServer> | null = null;

export function resourceServer(): Promise<x402ResourceServer> {
  if (!server) {
    const urls = (process.env.X402_FACILITATOR_URLS ?? DEFAULT_FACILITATORS)
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
    const instance = new x402ResourceServer(urls.map((url) => new HTTPFacilitatorClient({ url }))).register(
      network(),
      new ExactHederaScheme(),
    );
    server = instance.initialize().then(
      () => instance,
      (error: unknown) => {
        server = null;
        throw error;
      },
    );
  }
  return server;
}

async function requirementsFor(amountMicro: bigint): Promise<PaymentRequirements[]> {
  const payTo = process.env.HEDERA_TREASURY_ID;
  if (!payTo) throw new Error("HEDERA_TREASURY_ID is not set");
  return (await resourceServer()).buildPaymentRequirements({
    scheme: "exact",
    network: network(),
    payTo,
    price: { amount: amountMicro.toString(), asset: process.env.HEDERA_USDC ?? "0.0.429274" },
  });
}

export async function paymentRequired(amountMicro: bigint, resourceUrl: string, message: string): Promise<Response> {
  try {
    const required = await (await resourceServer()).createPaymentRequiredResponse(
      await requirementsFor(amountMicro),
      { url: resourceUrl, description: "Router balance top-up", mimeType: "application/json" },
      message,
    );
    const body: RouterError = { error: { message, type: "payment_error", code: "insufficient_balance" } };
    return Response.json(body, { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } });
  } catch (error) {
    return fail(502, "upstream_failed", `payments are unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export type Settlement = Payment & { responseHeader: string };

export async function settleTopup(
  header: string,
  bounds: { minMicro: bigint; maxMicro: bigint },
): Promise<Settlement | { error: string }> {
  try {
    const payload = decodePaymentSignatureHeader(header);
    const amount = amountSchema.safeParse(payload.accepted?.amount);
    if (!amount.success) return { error: "payment amount is not an integer" };
    const amountMicro = BigInt(amount.data);
    if (amountMicro < bounds.minMicro || amountMicro > bounds.maxMicro) {
      return { error: `payment must be between ${bounds.minMicro} and ${bounds.maxMicro} micro USD` };
    }
    const resource = await resourceServer();
    const match = resource.findMatchingRequirements(await requirementsFor(amountMicro), payload);
    if (!match) return { error: "payment does not match the offer" };
    const verified = await resource.verifyPayment(payload, match);
    if (!verified.isValid) return { error: verified.invalidMessage ?? verified.invalidReason ?? "payment rejected" };
    const settled = await resource.settlePayment(payload, match);
    if (!settled.success || !settled.transaction) {
      return { error: settled.errorMessage ?? settled.errorReason ?? "settlement failed" };
    }
    return {
      txId: settled.transaction,
      payer: settled.payer ?? verified.payer ?? "unknown",
      amountMicro,
      responseHeader: encodePaymentResponseHeader(settled),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "settlement failed" };
  }
}

export async function creditSettlement(keyId: string, settled: Settlement): Promise<bigint | Response> {
  try {
    const balance = await credit(keyId, settled);
    return balance ?? fail(409, "invalid_request", "this payment was already credited");
  } catch (error) {
    console.error("payment settled but not credited", settled.txId, error);
    return fail(502, "upstream_failed", `payment ${settled.txId} settled but was not credited; quote this id to support`);
  }
}

export type PaymentOutcome = { error: Response } | { header: string | null };

export async function applyPayment(request: Request, key: KeyRow): Promise<PaymentOutcome> {
  const header = request.headers.get("payment-signature");
  if (!header) return { header: null };
  const room = key.dailyTopupCapUsdMicro - (await toppedUpToday(key.id));
  if (room < 1n) return { error: fail(403, "approval_required", "today's top-up cap is used up") };
  const settled = await settleTopup(header, { minMicro: 1n, maxMicro: room });
  if ("error" in settled) return { error: fail(402, "insufficient_balance", `payment failed: ${settled.error}`) };
  const credited = await creditSettlement(key.id, settled);
  if (credited instanceof Response) return { error: credited };
  return { header: settled.responseHeader };
}

export async function paymentDue(request: Request, keyId: string, neededMicro: bigint): Promise<Response | null> {
  const row = (await db().select().from(keys).where(eq(keys.id, keyId)).limit(1))[0];
  if (!row) return fail(401, "invalid_api_key", "invalid router key");
  if (row.balanceUsdMicro >= neededMicro) return null;
  const short = neededMicro - row.balanceUsdMicro;
  if (row.autoTopupUsdMicro === 0n) {
    return fail(
      402,
      "insufficient_balance",
      `${short} more micro USD is needed; top up with POST /api/v1/topup or enable auto top-up`,
    );
  }
  const amount = row.autoTopupUsdMicro > short ? row.autoTopupUsdMicro : short;
  if (amount > TOPUP_MAX_MICRO) {
    return fail(402, "insufficient_balance", `${short} micro USD is more than one top-up can carry`);
  }
  const topped = await toppedUpToday(keyId);
  if (topped + amount > row.dailyTopupCapUsdMicro) {
    if (row.worldSub === null) {
      return fail(
        403,
        "approval_required",
        "link a human to this key first",
        {},
        await startApproval(keyId, "link_human", null),
      );
    }
    const approval = await startApproval(keyId, "raise_cap", topped + amount);
    return fail(
      403,
      "approval_required",
      `an auto top-up of ${amount} micro USD would pass the daily cap of ${row.dailyTopupCapUsdMicro} micro USD`,
      {},
      approval,
    );
  }
  return paymentRequired(amount, request.url, `auto top-up of ${amount} micro USD`);
}
