import type { SkillDraft } from "@archive-9/core";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { members, skillRevisions, skills } from "../schema.ts";

export interface SkillRow {
  id: string;
  name: string;
  kind: SkillDraft["kind"];
  triggers: string[];
  rule: string;
  authorId: string | null;
  authorName: string | null;
  usageCount: number;
  expiresAt: Date | null;
  channelId: string | null;
  memberId: string | null;
  createdAt: Date;
}

/** Not deleted, and not past its end for a temporary skill. */
const active = and(isNull(skills.deletedAt), sql`(${skills.expiresAt} is null or ${skills.expiresAt} > now())`);

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
      expiresAt: skills.expiresAt,
      channelId: skills.channelId,
      memberId: skills.memberId,
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
export async function createSkill(db: Database, draft: SkillDraft, authorId: string, expiresAt: Date | null = null): Promise<string | null> {
  // An expired skill still holds its name in the unique index until it is closed.
  await db
    .update(skills)
    .set({ deletedAt: sql`now()`, deletedBy: "expired" })
    .where(and(isNull(skills.deletedAt), sql`${skills.expiresAt} <= now()`));
  const rows = await db
    .insert(skills)
    .values({ ...draft, channelId: draft.channelId ?? null, memberId: draft.memberId ?? null, authorId, expiresAt })
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

/**
 * Replaces a skill's content, keeping the old version in its history. Null when it no
 * longer exists, false when another active skill already has the new name.
 */
export async function updateSkill(db: Database, id: string, draft: SkillDraft, expiresAt: Date | null, by: string): Promise<boolean | null> {
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(skills).where(and(eq(skills.id, id), active)).for("update");
    if (!old) return null;
    const [clash] = await tx
      .select({ id: skills.id })
      .from(skills)
      .where(and(active, eq(sql`lower(${skills.name})`, draft.name.toLowerCase()), sql`${skills.id} <> ${id}`));
    if (clash) return false;
    await tx.insert(skillRevisions).values({
      skillId: id,
      name: old.name,
      kind: old.kind,
      triggers: old.triggers,
      rule: old.rule,
      channelId: old.channelId,
      memberId: old.memberId,
      editedBy: by,
    });
    await tx
      .update(skills)
      .set({ ...draft, channelId: draft.channelId ?? null, memberId: draft.memberId ?? null, expiresAt, updatedAt: sql`now()` })
      .where(eq(skills.id, id));
    return true;
  });
}

export async function getSkill(db: Database, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await db.select().from(skills).where(and(eq(skills.id, id), active));
  return row;
}

/** Earlier versions of a skill, newest first. */
export async function skillHistory(db: Database, id: string) {
  return db
    .select({
      name: skillRevisions.name,
      kind: skillRevisions.kind,
      triggers: skillRevisions.triggers,
      rule: skillRevisions.rule,
      editedBy: sql<string | null>`coalesce(${members.displayName}, ${members.username})`,
      createdAt: skillRevisions.createdAt,
    })
    .from(skillRevisions)
    .leftJoin(members, eq(members.id, skillRevisions.editedBy))
    .where(eq(skillRevisions.skillId, id))
    .orderBy(sql`${skillRevisions.createdAt} desc`);
}
