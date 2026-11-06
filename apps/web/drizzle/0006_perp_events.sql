CREATE TABLE "perp_events" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"account" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"size" bigint NOT NULL,
	"margin" bigint NOT NULL,
	"price" bigint NOT NULL,
	"realized_pnl" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"reward" bigint NOT NULL,
	"block" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "perp_events_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index"),
	CONSTRAINT "perp_events_kind" CHECK ("perp_events"."kind" in ('modify','liquidate'))
);
--> statement-breakpoint
CREATE INDEX "perp_events_account_block_idx" ON "perp_events" USING btree ("account","block");