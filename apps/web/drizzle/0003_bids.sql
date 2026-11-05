CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" uuid NOT NULL,
	"model" text NOT NULL,
	"price_micro_per_mtok" bigint NOT NULL,
	"tokens" bigint NOT NULL,
	"hold_usd_micro" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_status" CHECK ("bids"."status" in ('open','filled','cancelled')),
	CONSTRAINT "bids_price_positive" CHECK ("bids"."price_micro_per_mtok" > 0),
	CONSTRAINT "bids_tokens_non_negative" CHECK ("bids"."tokens" >= 0),
	CONSTRAINT "bids_hold_non_negative" CHECK ("bids"."hold_usd_micro" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_model_status_price_idx" ON "bids" USING btree ("model","status","price_micro_per_mtok");--> statement-breakpoint
CREATE INDEX "bids_key_status_idx" ON "bids" USING btree ("key_id","status");