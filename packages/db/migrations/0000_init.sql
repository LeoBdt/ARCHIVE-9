CREATE TYPE "public"."action_status" AS ENUM('done', 'refused', 'failed', 'undone');--> statement-breakpoint
CREATE TYPE "public"."action_tier" AS ENUM('free', 'controlled');--> statement-breakpoint
CREATE TYPE "public"."ai_call_status" AS ENUM('ok', 'rate_limited', 'error');--> statement-breakpoint
CREATE TYPE "public"."ai_task" AS ENUM('triage', 'reply', 'analysis', 'reflection');--> statement-breakpoint
CREATE TYPE "public"."fact_category" AS ENUM('identity', 'tastes', 'games', 'humor', 'habits', 'projects', 'relationships', 'anecdotes', 'in_jokes', 'writing_style', 'other');--> statement-breakpoint
CREATE TYPE "public"."fact_nature" AS ENUM('fact', 'reported', 'probable_joke', 'inference');--> statement-breakpoint
CREATE TYPE "public"."self_state_source" AS ENUM('initial', 'reflection', 'rollback');--> statement-breakpoint
CREATE TABLE "actions_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"tier" "action_tier" NOT NULL,
	"params" jsonb NOT NULL,
	"status" "action_status" NOT NULL,
	"refusal_reason" text,
	"previous_value" jsonb,
	"requested_by" text,
	"source_message_id" text,
	"undone_at" timestamp with time zone,
	"undone_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task" "ai_task" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"upstream_provider" text,
	"fallback_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 8),
	"duration_ms" integer NOT NULL,
	"status" "ai_call_status" NOT NULL,
	"error" text,
	"reply_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"name_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_known_ai_bot" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_id" text,
	"mentioned_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"reactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"analysed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profile_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"category" "fact_category" NOT NULL,
	"content" text NOT NULL,
	"confidence" real NOT NULL,
	"nature" "fact_nature" NOT NULL,
	"source_message_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"reported_by" text,
	"superseded_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_facts_confidence_range" CHECK ("profile_facts"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "profile_summaries" (
	"member_id" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"fact_count" integer NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"affinity_delta" smallint NOT NULL,
	"trust_delta" smallint NOT NULL,
	"reason" text NOT NULL,
	"source_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"member_id" text PRIMARY KEY NOT NULL,
	"affinity" smallint DEFAULT 0 NOT NULL,
	"trust" smallint DEFAULT 50 NOT NULL,
	"feeling" text,
	"how_they_treat_me" text,
	"interaction_count" integer DEFAULT 0 NOT NULL,
	"introduced_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationships_affinity_range" CHECK ("relationships"."affinity" between -100 and 100),
	CONSTRAINT "relationships_trust_range" CHECK ("relationships"."trust" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "self_state_versions" (
	"version" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "self_state_versions_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"state" jsonb NOT NULL,
	"source" "self_state_source" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"rule" text NOT NULL,
	"author_id" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "actions_log" ADD CONSTRAINT "actions_log_requested_by_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_reported_by_members_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_superseded_by_profile_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."profile_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_summaries" ADD CONSTRAINT "profile_summaries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_events" ADD CONSTRAINT "relationship_events_member_id_relationships_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."relationships"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_log_created_at_index" ON "actions_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "actions_log_tool_created_at_index" ON "actions_log" USING btree ("tool","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_index" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_run_id_index" ON "ai_usage" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_usage_reply_message_ids_idx" ON "ai_usage" USING gin ("reply_message_ids");--> statement-breakpoint
CREATE INDEX "messages_channel_id_created_at_index" ON "messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_author_id_index" ON "messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "messages_pending_analysis_idx" ON "messages" USING btree ("created_at") WHERE "messages"."analysed_at" is null;--> statement-breakpoint
CREATE INDEX "messages_created_at_index" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "profile_facts_current_idx" ON "profile_facts" USING btree ("member_id") WHERE "profile_facts"."superseded_by" is null and "profile_facts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "relationship_events_member_id_created_at_index" ON "relationship_events" USING btree ("member_id","created_at");