CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"prepaid_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"model" text NOT NULL,
	"price_micro_per_mtok" bigint NOT NULL,
	"tokens" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offers_status" CHECK ("offers"."status" in ('open','filled','cancelled')),
	CONSTRAINT "offers_price_positive" CHECK ("offers"."price_micro_per_mtok" > 0),
	CONSTRAINT "offers_tokens_non_negative" CHECK ("offers"."tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "seller_key_id" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_prepaid_id_prepaid_id_fk" FOREIGN KEY ("prepaid_id") REFERENCES "public"."prepaid"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offers_model_status_price_idx" ON "offers" USING btree ("model","status","price_micro_per_mtok");--> statement-breakpoint
CREATE INDEX "offers_key_status_idx" ON "offers" USING btree ("key_id","status");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_key_id_keys_id_fk" FOREIGN KEY ("seller_key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_seller_key_created_idx" ON "trades" USING btree ("seller_key_id","created_at");