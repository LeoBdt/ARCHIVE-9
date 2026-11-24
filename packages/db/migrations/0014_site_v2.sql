ALTER TYPE "public"."self_state_source" ADD VALUE 'midday';--> statement-breakpoint
CREATE TABLE "fact_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"sha" text NOT NULL,
	"previous_sha" text,
	"comment" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"requester_id" text NOT NULL,
	"target_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"cost_usd" numeric(12, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skill_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "skill_kind" NOT NULL,
	"triggers" text[] DEFAULT '{}'::text[] NOT NULL,
	"rule" text NOT NULL,
	"channel_id" text,
	"member_id" text,
	"edited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "fact_categories" ("key", "label", "color") VALUES
	('identity', 'Identité', '#e9e9ee'),
	('tastes', 'Goûts', '#ff9f5a'),
	('games', 'Jeux', '#7cc4ff'),
	('humor', 'Humour', '#f5c04a'),
	('habits', 'Habitudes', '#5ad1c9'),
	('projects', 'Projets', '#6ee7a8'),
	('relationships', 'Liens', '#ff4757'),
	('anecdotes', 'Anecdotes', '#ff7ab6'),
	('in_jokes', 'Blagues internes', '#c4a0ff'),
	('writing_style', 'Façon d''écrire', '#a0b4ff'),
	('other', 'Divers', '#b9b9c3');--> statement-breakpoint
ALTER TABLE "profile_facts" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "served_model" text;--> statement-breakpoint
ALTER TABLE "fact_corrections" ADD COLUMN "by" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "verdict_reason" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "reviewed_label" numeric(7, 1);--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "source" text DEFAULT 'discord' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "self_state_versions" ADD COLUMN "label" numeric(7, 1) DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "self_state_versions" SET "label" = "version";--> statement-breakpoint
ALTER TABLE "self_state_versions" ALTER COLUMN "label" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "releases_kind_sha_idx" ON "releases" USING btree ("kind","sha");--> statement-breakpoint
CREATE INDEX "releases_kind_created_at_index" ON "releases" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "site_requests_status_created_at_index" ON "site_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "site_requests_created_at_index" ON "site_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "skill_revisions_skill_id_created_at_index" ON "skill_revisions" USING btree ("skill_id","created_at");--> statement-breakpoint
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_category_fact_categories_key_fk" FOREIGN KEY ("category") REFERENCES "public"."fact_categories"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "fact_corrections_fact_id_index" ON "fact_corrections" USING btree ("fact_id");--> statement-breakpoint
DROP TYPE "public"."fact_category";--> statement-breakpoint
CREATE TRIGGER site_requests_live AFTER INSERT OR UPDATE ON site_requests FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER releases_live AFTER INSERT ON releases FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER fact_categories_live AFTER INSERT OR UPDATE ON fact_categories FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();
