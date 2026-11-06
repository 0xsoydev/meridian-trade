CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"world_nullifier" numeric(78, 0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_address_unique" UNIQUE("address"),
	CONSTRAINT "accounts_world_nullifier_unique" UNIQUE("world_nullifier")
);
--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "keys" ADD CONSTRAINT "keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;