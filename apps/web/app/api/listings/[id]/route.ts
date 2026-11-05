import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { expectedHost, verifySigned } from "../../../../lib/auth.ts";
import { matchBids } from "../../../../lib/bids.ts";
import { db } from "../../../../lib/db.ts";
import { fail } from "../../../../lib/errors.ts";
import { listingPriceError, parseCapacityMtok } from "../../../../lib/listings.ts";
import { catalog } from "../../../../lib/rails.ts";
import { listings, sellers } from "../../../../lib/schema.ts";

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const amendIntent = z
  .object({
    domain: z.string(),
    action: z.literal("amend"),
    issued_at: z.string(),
    listing_id: idSchema,
    price_micro_per_mtok: z.string().regex(/^\d{1,18}$/).nullable(),
    capacity_mtok: z.string().regex(/^\d{1,18}$/),
    client_nonce: z.string().min(8).max(128),
  })
  .strict();

const cancelIntent = z
  .object({
    domain: z.string(),
    action: z.literal("cancel"),
    issued_at: z.string(),
    listing_id: idSchema,
    client_nonce: z.string().min(8).max(128),
  })
  .strict();

const signedBody = z.object({ signed: z.unknown() }).strict();

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function ownedListing(id: string, address: string) {
  const [row] = await db()
    .select({ listing: listings, sellerAddress: sellers.address })
    .from(listings)
    .innerJoin(sellers, eq(listings.sellerId, sellers.id))
    .where(eq(listings.id, id))
    .limit(1);
  return row && row.sellerAddress === address ? row.listing : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail(404, "invalid_request", "listing not found");

  const parsed = signedBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid amend request");

  const verified = await verifySigned(parsed.data.signed, expectedHost(request), "amend");
  if (!verified) return fail(401, "invalid_api_key", "invalid wallet signature");

  const intent = amendIntent.safeParse(verified.intent);
  if (!intent.success) return fail(400, "invalid_request", "invalid amend intent");
  if (intent.data.listing_id !== id) return fail(400, "invalid_request", "listing intent mismatch");

  const listing = await ownedListing(id, verified.address);
  if (!listing) return fail(404, "invalid_request", "listing not found");
  if (listing.status === "cancelled") return fail(409, "invalid_request", "listing is cancelled");

  const rails = await catalog();
  const rail = rails.find((entry) => entry.id === listing.rail);
  const model = rail?.models.find((entry) => entry.canonical === listing.model);
  if (!rail || !model) return fail(400, "invalid_request", "listing rail is not enabled");

  const price =
    intent.data.price_micro_per_mtok === null ? null : BigInt(intent.data.price_micro_per_mtok);
  const priceError = listingPriceError(
    price,
    { prompt: model.listPrompt, completion: model.listCompletion },
    rail.resetPeriod,
  );
  if (priceError) return fail(400, "invalid_request", priceError);

  const capacityTokens = parseCapacityMtok(intent.data.capacity_mtok);
  if (capacityTokens === null) return fail(400, "invalid_request", "invalid capacity");
  if (capacityTokens < listing.usedTokens + listing.reservedTokens) {
    return fail(409, "invalid_request", "capacity is below committed tokens");
  }

  try {
    const [updated] = await db()
      .update(listings)
      .set({
        priceMicroPerMtok: price,
        capacityTokens,
        clientNonce: intent.data.client_nonce,
        status: sql`case when ${listings.status} = 'exhausted' and ${listings.usedTokens} + ${listings.reservedTokens} < ${capacityTokens} then 'active' else ${listings.status} end`,
      })
      .where(
        and(
          eq(listings.id, id),
          eq(listings.sellerId, listing.sellerId),
          ne(listings.status, "cancelled"),
          sql`${listings.usedTokens} + ${listings.reservedTokens} <= ${capacityTokens}`,
        ),
      )
      .returning({
        id: listings.id,
        price: listings.priceMicroPerMtok,
        capacity: listings.capacityTokens,
        status: listings.status,
      });

    if (!updated) return fail(409, "invalid_request", "capacity is below committed tokens");
    await matchBids(listing.model).catch(() => 0);

    return Response.json({
      listing_id: updated.id,
      price_micro_per_mtok: updated.price === null ? null : updated.price.toString(),
      capacity_tokens: updated.capacity.toString(),
      status: updated.status,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "invalid_request", "client_nonce has already been used");
    throw error;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail(404, "invalid_request", "listing not found");

  const parsed = signedBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "invalid cancel request");

  const verified = await verifySigned(parsed.data.signed, expectedHost(request), "cancel");
  if (!verified) return fail(401, "invalid_api_key", "invalid wallet signature");

  const intent = cancelIntent.safeParse(verified.intent);
  if (!intent.success) return fail(400, "invalid_request", "invalid cancel intent");
  if (intent.data.listing_id !== id) return fail(400, "invalid_request", "listing intent mismatch");

  const listing = await ownedListing(id, verified.address);
  if (!listing) return fail(404, "invalid_request", "listing not found");

  const [updated] = await db()
    .update(listings)
    .set({ status: "cancelled", clientNonce: intent.data.client_nonce })
    .where(
      and(
        eq(listings.id, id),
        eq(listings.sellerId, listing.sellerId),
        ne(listings.status, "cancelled"),
        eq(listings.reservedTokens, 0n),
      ),
    )
    .returning({ id: listings.id, status: listings.status });

  if (!updated) return fail(409, "invalid_request", "a reservation is open on this listing");

  return Response.json({ listing_id: updated.id, status: updated.status });
}
