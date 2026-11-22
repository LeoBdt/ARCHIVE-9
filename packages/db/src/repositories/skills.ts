import type { SkillDraft } from "@archive-9/core";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { members, skills } from "../schema.ts";

export interface SkillRow {
  id: string;
  name: string;
  kind: SkillDraft["kind"];
  triggers: string[];
  rule: string;
  authorId: string | null;
  authorName: string | null;
  usageCount: number;
  createdAt: Date;
}

const active = isNull(skills.deletedAt);

/** Every skill in use, oldest first so the order of permanent skills stays stable. */
export async function activeSkills(db: Database): Promise<SkillRow[]> {
  return db
    .select({
      id: skills.id,
      name: skills.name,
      kind: skills.kind,
      triggers: skills.triggers,
      rule: skills.rule,
      authorId: skills.authorId,
      authorName: sql<string | null>`coalesce(${members.displayName}, ${members.username})`,
      usageCount: skills.usageCount,
      createdAt: skills.createdAt,
    })
    .from(skills)
    .leftJoin(members, eq(members.id, skills.authorId))
    .where(active)
    .orderBy(skills.createdAt);
}

export async function skillCounts(db: Database, authorId: string) {
  const [row] = await db
    .select({
      total: count(),
      byAuthor: sql<number>`count(*) filter (where ${skills.authorId} = ${authorId})::int`,
      permanent: sql<number>`count(*) filter (where ${skills.kind} = 'permanent')::int`,
    })
    .from(skills)
    .where(active);
  return { total: row?.total ?? 0, byAuthor: row?.byAuthor ?? 0, permanent: row?.permanent ?? 0 };
}

/** Returns the new ID, or null when an active skill already has this name. */
export async function createSkill(db: Database, draft: SkillDraft, authorId: string): Promise<string | null> {
  const rows = await db
    .insert(skills)
    .values({ ...draft, authorId })
    .onConflictDoNothing()
    .returning({ id: skills.id });
  return rows[0]?.id ?? null;
}

export async function findActiveSkill(db: Database, name: string) {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(active, eq(sql`lower(${skills.name})`, name.trim().toLowerCase())));
  return row;
}

export async function deleteSkill(db: Database, id: string, by: string): Promise<boolean> {
  const rows = await db
    .update(skills)
    .set({ deletedAt: sql`now()`, deletedBy: by })
    .where(and(eq(skills.id, id), active))
    .returning({ id: skills.id });
  return rows.length > 0;
}

/** Counts one use for each skill given to a reply that actually spoke. */
export async function recordSkillUse(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(skills)
    .set({ usageCount: sql`${skills.usageCount} + 1`, lastUsedAt: sql`now()` })
    .where(inArray(skills.id, ids));
}

/** Newest first, for `/skills`. */
export async function listSkills(db: Database, limit = 50) {
  return (await activeSkills(db)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}
