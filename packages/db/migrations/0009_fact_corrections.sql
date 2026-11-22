CREATE TABLE "fact_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"fact_id" uuid,
	"content" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fact_corrections" ADD CONSTRAINT "fact_corrections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_corrections" ADD CONSTRAINT "fact_corrections_fact_id_profile_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."profile_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fact_corrections_member_id_created_at_index" ON "fact_corrections" USING btree ("member_id","created_at");