CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cap_usd_micro" bigint,
	"device_code_ciphertext" text NOT NULL,
	"user_code" text NOT NULL,
	"verification_uri_complete" text NOT NULL,
	"interval_s" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_kind" CHECK ("approvals"."kind" in ('link_human','raise_cap')),
	CONSTRAINT "approvals_status" CHECK ("approvals"."status" in ('pending','approved','denied','expired'))
);
--> statement-breakpoint
CREATE TABLE "keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" "bytea" NOT NULL,
	"balance_usd_micro" bigint NOT NULL,
	"reserved_usd_micro" bigint DEFAULT 0 NOT NULL,
	"auto_topup_usd_micro" bigint DEFAULT 0 NOT NULL,
	"daily_topup_cap_usd_micro" bigint DEFAULT 5000000 NOT NULL,
	"default_model" text,
	"world_sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keys_hash_unique" UNIQUE("hash"),
	CONSTRAINT "keys_balance_non_negative" CHECK ("keys"."balance_usd_micro" >= 0),
	CONSTRAINT "keys_reserved_non_negative" CHECK ("keys"."reserved_usd_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"model" text NOT NULL,
	"auth_kind" text NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"account_ref" text,
	"price_micro_per_mtok" bigint,
	"capacity_tokens" bigint NOT NULL,
	"used_tokens" bigint DEFAULT 0 NOT NULL,
	"reserved_tokens" bigint DEFAULT 0 NOT NULL,
	"throttled_until" timestamp with time zone,
	"status" text NOT NULL,
	"client_nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_client_nonce_unique" UNIQUE("client_nonce"),
	CONSTRAINT "listings_capacity_positive" CHECK ("listings"."capacity_tokens" > 0),
	CONSTRAINT "listings_capacity_bound" CHECK ("listings"."used_tokens" + "listings"."reserved_tokens" <= "listings"."capacity_tokens"),
	CONSTRAINT "listings_auth_kind" CHECK ("listings"."auth_kind" in ('key','oauth')),
	CONSTRAINT "listings_status" CHECK ("listings"."status" in ('active','exhausted','invalid','cancelled','pending_auth'))
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"day" date NOT NULL,
	"amount_usd_micro" bigint NOT NULL,
	"schedule_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_status" CHECK ("payouts"."status" in ('pending','scheduled','executed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "prepaid" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"model" text NOT NULL,
	"tokens_remaining" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepaid_tokens_non_negative" CHECK ("prepaid"."tokens_remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"world_nullifier" numeric(78, 0) NOT NULL,
	"hedera_account" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_address_unique" UNIQUE("address"),
	CONSTRAINT "sellers_world_nullifier_unique" UNIQUE("world_nullifier")
);
--> statement-breakpoint
CREATE TABLE "topups" (
	"tx_id" text PRIMARY KEY NOT NULL,
	"key_id" uuid NOT NULL,
	"amount_usd_micro" bigint NOT NULL,
	"payer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"model" text NOT NULL,
	"tokens" bigint NOT NULL,
	"price_micro_per_mtok" bigint NOT NULL,
	"charge_usd_micro" bigint NOT NULL,
	"seller_earning_usd_micro" bigint NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_tokens_positive" CHECK ("trades"."tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"rail" text NOT NULL,
	"upstream_request_id" text,
	"key_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"price_micro_per_mtok" bigint NOT NULL,
	"reserved_tokens" bigint DEFAULT 0 NOT NULL,
	"reserved_usd_micro" bigint DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"list_cost_usd_micro" bigint DEFAULT 0 NOT NULL,
	"mixed_tokens" bigint DEFAULT 0 NOT NULL,
	"charge_usd_micro" bigint DEFAULT 0 NOT NULL,
	"seller_earning_usd_micro" bigint DEFAULT 0 NOT NULL,
	"payout_id" uuid,
	"hcs_minute" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "usage_status" CHECK ("usage"."status" in ('open','settled','released'))
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid" ADD CONSTRAINT "prepaid_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid" ADD CONSTRAINT "prepaid_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topups" ADD CONSTRAINT "topups_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_model_status_price_idx" ON "listings" USING btree ("model","status","price_micro_per_mtok");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_seller_day_key" ON "payouts" USING btree ("seller_id","day");--> statement-breakpoint
CREATE INDEX "prepaid_key_model_expires_idx" ON "prepaid" USING btree ("key_id","model","expires_at");--> statement-breakpoint
CREATE INDEX "topups_key_created_idx" ON "topups" USING btree ("key_id","created_at");--> statement-breakpoint
CREATE INDEX "trades_created_idx" ON "trades" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trades_listing_payout_idx" ON "trades" USING btree ("listing_id","payout_id");--> statement-breakpoint
CREATE INDEX "trades_key_created_idx" ON "trades" USING btree ("key_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_upstream_request_id_key" ON "usage" USING btree ("upstream_request_id") WHERE "usage"."upstream_request_id" is not null;--> statement-breakpoint
CREATE INDEX "usage_status_created_idx" ON "usage" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "usage_settled_at_idx" ON "usage" USING btree ("settled_at");--> statement-breakpoint
CREATE INDEX "usage_listing_payout_idx" ON "usage" USING btree ("listing_id","payout_id");