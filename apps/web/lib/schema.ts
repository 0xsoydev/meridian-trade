import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const sellers = pgTable("sellers", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull().unique(),
  worldNullifier: numeric("world_nullifier", { precision: 78, scale: 0 }).notNull().unique(),
  hederaAccount: text("hedera_account"),
  createdAt: createdAt(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: text("address").notNull().unique(),
  worldNullifier: numeric("world_nullifier", { precision: 78, scale: 0 }).unique(),
  createdAt: createdAt(),
});

export const keys = pgTable(
  "keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id),
    hash: bytea("hash").notNull().unique(),
    balanceUsdMicro: bigint("balance_usd_micro", { mode: "bigint" }).notNull(),
    reservedUsdMicro: bigint("reserved_usd_micro", { mode: "bigint" }).notNull().default(sql`0`),
    autoTopupUsdMicro: bigint("auto_topup_usd_micro", { mode: "bigint" }).notNull().default(sql`0`),
    dailyTopupCapUsdMicro: bigint("daily_topup_cap_usd_micro", { mode: "bigint" })
      .notNull()
      .default(sql`5000000`),
    defaultModel: text("default_model"),
    worldSub: text("world_sub"),
    createdAt: createdAt(),
  },
  (t) => [
    check("keys_balance_non_negative", sql`${t.balanceUsdMicro} >= 0`),
    check("keys_reserved_non_negative", sql`${t.reservedUsdMicro} >= 0`),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id),
    rail: text("rail").notNull(),
    model: text("model").notNull(),
    authKind: text("auth_kind").notNull(),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    accountRef: text("account_ref"),
    priceMicroPerMtok: bigint("price_micro_per_mtok", { mode: "bigint" }),
    capacityTokens: bigint("capacity_tokens", { mode: "bigint" }).notNull(),
    usedTokens: bigint("used_tokens", { mode: "bigint" }).notNull().default(sql`0`),
    reservedTokens: bigint("reserved_tokens", { mode: "bigint" }).notNull().default(sql`0`),
    throttledUntil: timestamp("throttled_until", { withTimezone: true }),
    status: text("status").notNull(),
    resetOn: date("reset_on", { mode: "string" })
      .notNull()
      .default(sql`(now() at time zone 'utc')::date`),
    clientNonce: text("client_nonce").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check("listings_capacity_positive", sql`${t.capacityTokens} > 0`),
    check(
      "listings_capacity_bound",
      sql`${t.usedTokens} + ${t.reservedTokens} <= ${t.capacityTokens}`,
    ),
    check("listings_auth_kind", sql`${t.authKind} in ('key','oauth')`),
    check(
      "listings_status",
      sql`${t.status} in ('active','exhausted','invalid','cancelled','pending_auth')`,
    ),
    index("listings_model_status_price_idx").on(t.model, t.status, t.priceMicroPerMtok),
  ],
);

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellers.id),
    day: date("day", { mode: "string" }).notNull(),
    amountUsdMicro: bigint("amount_usd_micro", { mode: "bigint" }).notNull(),
    scheduleId: text("schedule_id"),
    executeAt: timestamp("execute_at", { withTimezone: true }),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payouts_seller_day_key").on(t.sellerId, t.day),
    check(
      "payouts_status",
      sql`${t.status} in ('pending','scheduled','executed','cancelled')`,
    ),
  ],
);

export const topups = pgTable(
  "topups",
  {
    txId: text("tx_id").primaryKey(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    amountUsdMicro: bigint("amount_usd_micro", { mode: "bigint" }).notNull(),
    payer: text("payer").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("topups_key_created_idx").on(t.keyId, t.createdAt)],
);

export const usage = pgTable(
  "usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").notNull(),
    rail: text("rail").notNull(),
    upstreamRequestId: text("upstream_request_id"),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    prepaidId: uuid("prepaid_id").references(() => prepaid.id),
    priceMicroPerMtok: bigint("price_micro_per_mtok", { mode: "bigint" }).notNull(),
    reservedTokens: bigint("reserved_tokens", { mode: "bigint" }).notNull().default(sql`0`),
    reservedUsdMicro: bigint("reserved_usd_micro", { mode: "bigint" }).notNull().default(sql`0`),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    listCostUsdMicro: bigint("list_cost_usd_micro", { mode: "bigint" }).notNull().default(sql`0`),
    mixedTokens: bigint("mixed_tokens", { mode: "bigint" }).notNull().default(sql`0`),
    chargeUsdMicro: bigint("charge_usd_micro", { mode: "bigint" }).notNull().default(sql`0`),
    sellerEarningUsdMicro: bigint("seller_earning_usd_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    payoutId: uuid("payout_id").references(() => payouts.id),
    hcsMinute: bigint("hcs_minute", { mode: "bigint" }),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    check("usage_status", sql`${t.status} in ('open','settled','released')`),
    uniqueIndex("usage_upstream_request_id_key")
      .on(t.upstreamRequestId)
      .where(sql`${t.upstreamRequestId} is not null`),
    index("usage_status_created_idx").on(t.status, t.createdAt),
    index("usage_settled_at_idx").on(t.settledAt),
    index("usage_listing_payout_idx").on(t.listingId, t.payoutId),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    model: text("model").notNull(),
    tokens: bigint("tokens", { mode: "bigint" }).notNull(),
    priceMicroPerMtok: bigint("price_micro_per_mtok", { mode: "bigint" }).notNull(),
    chargeUsdMicro: bigint("charge_usd_micro", { mode: "bigint" }).notNull(),
    sellerEarningUsdMicro: bigint("seller_earning_usd_micro", { mode: "bigint" }).notNull(),
    payoutId: uuid("payout_id").references(() => payouts.id),
    sellerKeyId: uuid("seller_key_id").references(() => keys.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("trades_tokens_positive", sql`${t.tokens} > 0`),
    index("trades_created_idx").on(t.createdAt),
    index("trades_listing_payout_idx").on(t.listingId, t.payoutId),
    index("trades_key_created_idx").on(t.keyId, t.createdAt),
    index("trades_seller_key_created_idx").on(t.sellerKeyId, t.createdAt),
  ],
);

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    model: text("model").notNull(),
    priceMicroPerMtok: bigint("price_micro_per_mtok", { mode: "bigint" }).notNull(),
    tokens: bigint("tokens", { mode: "bigint" }).notNull(),
    holdUsdMicro: bigint("hold_usd_micro", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("bids_status", sql`${t.status} in ('open','filled','cancelled')`),
    check("bids_price_positive", sql`${t.priceMicroPerMtok} > 0`),
    check("bids_tokens_non_negative", sql`${t.tokens} >= 0`),
    check("bids_hold_non_negative", sql`${t.holdUsdMicro} >= 0`),
    index("bids_model_status_price_idx").on(t.model, t.status, t.priceMicroPerMtok),
    index("bids_key_status_idx").on(t.keyId, t.status),
  ],
);

export const prepaid = pgTable(
  "prepaid",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    model: text("model").notNull(),
    tokensRemaining: bigint("tokens_remaining", { mode: "bigint" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("prepaid_tokens_non_negative", sql`${t.tokensRemaining} >= 0`),
    index("prepaid_key_model_expires_idx").on(t.keyId, t.model, t.expiresAt),
  ],
);

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    prepaidId: uuid("prepaid_id")
      .notNull()
      .references(() => prepaid.id),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    model: text("model").notNull(),
    priceMicroPerMtok: bigint("price_micro_per_mtok", { mode: "bigint" }).notNull(),
    tokens: bigint("tokens", { mode: "bigint" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("offers_status", sql`${t.status} in ('open','filled','cancelled')`),
    check("offers_price_positive", sql`${t.priceMicroPerMtok} > 0`),
    check("offers_tokens_non_negative", sql`${t.tokens} >= 0`),
    index("offers_model_status_price_idx").on(t.model, t.status, t.priceMicroPerMtok),
    index("offers_key_status_idx").on(t.keyId, t.status),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => keys.id),
    kind: text("kind").notNull(),
    capUsdMicro: bigint("cap_usd_micro", { mode: "bigint" }),
    deviceCodeCiphertext: text("device_code_ciphertext").notNull(),
    userCode: text("user_code").notNull(),
    verificationUriComplete: text("verification_uri_complete").notNull(),
    intervalS: integer("interval_s").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("approvals_kind", sql`${t.kind} in ('link_human','raise_cap')`),
    check("approvals_status", sql`${t.status} in ('pending','approved','denied','expired')`),
  ],
);

export const perpEvents = pgTable(
  "perp_events",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    account: text("account").notNull(),
    model: text("model").notNull(),
    kind: text("kind").notNull(),
    size: bigint("size", { mode: "bigint" }).notNull(),
    margin: bigint("margin", { mode: "bigint" }).notNull(),
    price: bigint("price", { mode: "bigint" }).notNull(),
    realizedPnl: bigint("realized_pnl", { mode: "bigint" }).notNull(),
    fee: bigint("fee", { mode: "bigint" }).notNull(),
    reward: bigint("reward", { mode: "bigint" }).notNull(),
    block: bigint("block", { mode: "bigint" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    check("perp_events_kind", sql`${t.kind} in ('modify','liquidate')`),
    index("perp_events_account_block_idx").on(t.account, t.block),
  ],
);

export const comfyAgents = pgTable("comfy_agents", {
  keyId: uuid("key_id")
    .primaryKey()
    .references(() => keys.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  createdAt: createdAt(),
});

export type SellerRow = typeof sellers.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;
export type KeyRow = typeof keys.$inferSelect;
export type UsageRow = typeof usage.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type PrepaidRow = typeof prepaid.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
