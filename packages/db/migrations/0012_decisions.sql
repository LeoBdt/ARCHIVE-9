CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"message_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"guild_id" text,
	"author_id" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"addressed" boolean DEFAULT false NOT NULL,
	"in_agents" boolean DEFAULT false NOT NULL,
	"interest" smallint,
	"content" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "decisions_created_at_index" ON "decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "decisions_outcome_created_at_index" ON "decisions" USING btree ("outcome","created_at");