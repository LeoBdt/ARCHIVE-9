ALTER TYPE "public"."ai_task" ADD VALUE 'vision';--> statement-breakpoint
ALTER TYPE "public"."ai_task" ADD VALUE 'embedding';--> statement-breakpoint
CREATE TABLE "capability_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'gap' NOT NULL,
	"content" text NOT NULL,
	"reason" text,
	"label" numeric(7, 1),
	"source" text DEFAULT 'reflection' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"answered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"fact_id" uuid,
	"op" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE "message_images" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"description" text,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"described_at" timestamp with time zone
);
--> statement-breakpoint
-- Fragment references (#K7QX3M, Crockford alphabet) and numbers (F001…), drawn by the database.
CREATE OR REPLACE FUNCTION a9_fragment_ref() RETURNS text AS $$
  SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1), '') FROM generate_series(1, 6)
$$ LANGUAGE sql VOLATILE;--> statement-breakpoint
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_affinity_range";--> statement-breakpoint
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_trust_range";--> statement-breakpoint
ALTER TABLE "relationship_events" ALTER COLUMN "affinity_delta" SET DATA TYPE numeric(3, 1);--> statement-breakpoint
ALTER TABLE "relationship_events" ALTER COLUMN "trust_delta" SET DATA TYPE numeric(3, 1);--> statement-breakpoint
ALTER TABLE "relationships" ALTER COLUMN "affinity" SET DATA TYPE numeric(4, 1);--> statement-breakpoint
ALTER TABLE "relationships" ALTER COLUMN "trust" SET DATA TYPE numeric(4, 1);--> statement-breakpoint
ALTER TABLE "relationships" ALTER COLUMN "trust" SET DEFAULT 25;--> statement-breakpoint
ALTER TABLE "fact_categories" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "dm_private_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "dm_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "tidied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD COLUMN "ref" text DEFAULT a9_fragment_ref() NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_facts" ADD COLUMN "number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_operations" ADD CONSTRAINT "fact_operations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_operations" ADD CONSTRAINT "fact_operations_fact_id_profile_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."profile_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_images" ADD CONSTRAINT "message_images_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_gaps_created_at_index" ON "capability_gaps" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "capability_gaps_status_index" ON "capability_gaps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fact_operations_created_at_index" ON "fact_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "fact_operations_status_created_at_index" ON "fact_operations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "fact_operations_member_id_index" ON "fact_operations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "message_images_message_id_index" ON "message_images" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_images_pending_idx" ON "message_images" USING btree ("created_at") WHERE "message_images"."described_at" is null;--> statement-breakpoint
ALTER TABLE "fact_categories" ADD CONSTRAINT "fact_categories_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Two fragments drew the same reference: draw again until they are all different.
DO $$ BEGIN
  WHILE EXISTS (SELECT 1 FROM profile_facts GROUP BY ref HAVING count(*) > 1) LOOP
    UPDATE profile_facts SET ref = a9_fragment_ref()
    WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY ref ORDER BY id) AS rn FROM profile_facts) d WHERE rn > 1);
  END LOOP;
END $$;--> statement-breakpoint
-- Numbers and references: each first version gets its rank in the dossier, and every later
-- version keeps both.
WITH RECURSIVE roots AS (
  SELECT f.id, f.ref, row_number() OVER (PARTITION BY f.member_id ORDER BY f.created_at, f.id) AS n
  FROM profile_facts f
  WHERE NOT EXISTS (SELECT 1 FROM profile_facts o WHERE o.superseded_by = f.id)
), chain AS (
  SELECT id, ref, n FROM roots
  UNION ALL
  SELECT f.superseded_by, c.ref, c.n FROM chain c JOIN profile_facts f ON f.id = c.id WHERE f.superseded_by IS NOT NULL
)
UPDATE profile_facts p SET number = c.n, ref = c.ref FROM chain c WHERE p.id = c.id;--> statement-breakpoint
CREATE OR REPLACE FUNCTION a9_fragment_number() RETURNS trigger AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('a9_fragment_number:' || NEW.member_id));
    SELECT coalesce(max(number), 0) + 1 INTO NEW.number FROM profile_facts WHERE member_id = NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER profile_facts_number BEFORE INSERT ON profile_facts FOR EACH ROW EXECUTE FUNCTION a9_fragment_number();--> statement-breakpoint
CREATE UNIQUE INDEX "profile_facts_ref_idx" ON "profile_facts" USING btree ("ref") WHERE "profile_facts"."superseded_by" is null and "profile_facts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "profile_facts_member_id_number_index" ON "profile_facts" USING btree ("member_id","number");--> statement-breakpoint
CREATE INDEX "profile_facts_sources_idx" ON "profile_facts" USING gin ("source_message_ids");--> statement-breakpoint
-- Relations move to −50…+50 and 0…50 in steps of 0.1 to 0.5, at most ±1 a day. The whole
-- history is replayed once: ±1 becomes 0.1, ±2 becomes 0.3, ±3 and more 0.5.
DO $$
DECLARE
  r record;
  so_far_a numeric;
  so_far_t numeric;
  a numeric;
  t numeric;
BEGIN
  FOR r IN SELECT id, member_id, affinity_delta, trust_delta, created_at FROM relationship_events ORDER BY member_id, created_at, id LOOP
    SELECT coalesce(sum(affinity_delta), 0), coalesce(sum(trust_delta), 0) INTO so_far_a, so_far_t
    FROM relationship_events e
    WHERE e.member_id = r.member_id AND e.created_at > r.created_at - interval '24 hours' AND (e.created_at, e.id) < (r.created_at, r.id);
    a := sign(r.affinity_delta) * CASE WHEN abs(r.affinity_delta) >= 3 THEN 0.5 WHEN abs(r.affinity_delta) >= 2 THEN 0.3 WHEN abs(r.affinity_delta) >= 1 THEN 0.1 ELSE 0 END;
    t := sign(r.trust_delta) * CASE WHEN abs(r.trust_delta) >= 3 THEN 0.5 WHEN abs(r.trust_delta) >= 2 THEN 0.3 WHEN abs(r.trust_delta) >= 1 THEN 0.1 ELSE 0 END;
    a := CASE WHEN a > 0 THEN least(a, greatest(0, 1 - so_far_a)) WHEN a < 0 THEN greatest(a, least(0, -1 - so_far_a)) ELSE 0 END;
    t := CASE WHEN t > 0 THEN least(t, greatest(0, 1 - so_far_t)) WHEN t < 0 THEN greatest(t, least(0, -1 - so_far_t)) ELSE 0 END;
    UPDATE relationship_events SET affinity_delta = a, trust_delta = t WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
DELETE FROM relationship_events WHERE affinity_delta = 0 AND trust_delta = 0;--> statement-breakpoint
UPDATE relationships r SET
  affinity = greatest(-50, least(50, coalesce((SELECT sum(e.affinity_delta) FROM relationship_events e WHERE e.member_id = r.member_id), 0))),
  trust = greatest(0, least(50, 25 + coalesce((SELECT sum(e.trust_delta) FROM relationship_events e WHERE e.member_id = r.member_id), 0)));--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_affinity_range" CHECK ("relationships"."affinity" between -50 and 50);--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_trust_range" CHECK ("relationships"."trust" between 0 and 50);;--> statement-breakpoint
-- Two new starting drawers, and the drawers it opened that only ever held one person's
-- fragments become that person's own.
INSERT INTO "fact_categories" ("key", "label", "color") VALUES
	('background', 'Parcours', '#d6b38a'),
	('opinions', 'Avis', '#9be36b')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE fact_categories c SET member_id = x.member_id
FROM (
  SELECT category, min(member_id) AS member_id FROM profile_facts
  WHERE superseded_by IS NULL AND deleted_at IS NULL GROUP BY category HAVING count(DISTINCT member_id) = 1
) x
WHERE c.key = x.category AND c.created_by = 'archive-9';--> statement-breakpoint
-- Search: words with French stemming, accents ignored, and trigrams for typos and parts of words.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION a9_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;--> statement-breakpoint
CREATE INDEX "profile_facts_fts_idx" ON "profile_facts" USING gin (to_tsvector('french', a9_unaccent("content")));--> statement-breakpoint
CREATE INDEX "profile_facts_trgm_idx" ON "profile_facts" USING gin (a9_unaccent(lower("content")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "messages_fts_idx" ON "messages" USING gin (to_tsvector('french', a9_unaccent("content")));--> statement-breakpoint
CREATE INDEX "messages_trgm_idx" ON "messages" USING gin (a9_unaccent(lower("content")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "message_images_fts_idx" ON "message_images" USING gin (to_tsvector('french', a9_unaccent(coalesce("description", ''))));--> statement-breakpoint
CREATE TRIGGER fact_operations_live AFTER INSERT OR UPDATE ON fact_operations FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();--> statement-breakpoint
CREATE TRIGGER capability_gaps_live AFTER INSERT OR UPDATE ON capability_gaps FOR EACH STATEMENT EXECUTE FUNCTION archive9_notify_site();