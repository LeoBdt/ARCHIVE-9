ALTER TABLE "skills" DROP COLUMN "trigger";--> statement-breakpoint
CREATE TYPE "public"."skill_kind" AS ENUM('triggered', 'permanent');--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "kind" "skill_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "triggers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_active_name_idx" ON "skills" USING btree (lower("name")) WHERE "skills"."deleted_at" is null;