ALTER TABLE "profile_summaries" ADD COLUMN "tagline" text;--> statement-breakpoint
CREATE INDEX "profile_facts_created_at_index" ON "profile_facts" USING btree ("created_at");