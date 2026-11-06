CREATE TABLE "comfy_agents" (
	"key_id" uuid PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comfy_agents" ADD CONSTRAINT "comfy_agents_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE cascade ON UPDATE no action;