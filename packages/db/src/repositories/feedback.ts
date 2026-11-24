import { and, asc, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { feedback, memberPreferences, members, relationships } from "../schema.ts";

export const FEEDBACK_PER_DAY = 5;
export const PREFERENCES_PER_MEMBER = 10;

const name = sql<string>`coalesce(${members.displayName}, ${members.username})`;

/** Stores a member's feedback; false once they gave too much of it today. */
export async function addFeedback(
  db: Database,
  authorId: string,
  content: string,
  sourceMessageId: string | null,
  extra: { source?: "discord" | "site"; about?: string | null } = {},
): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(feedback)
    .where(and(eq(feedback.authorId, authorId), gte(feedback.createdAt, sql`now() - interval '1 day'`)));
  if ((row?.n ?? 0) >= FEEDBACK_PER_DAY) return false;
  await db.insert(feedback).values({ authorId, content, sourceMessageId, source: extra.source ?? "discord", about: extra.about ?? null });
  return true;
}

export type FeedbackVerdict = "adopted" | "partial" | "ignored";

/** What the evening reflection decided about each piece of feedback it read. */
export async function markFeedbackVerdicts(db: Database, verdicts: { id: string; verdict: FeedbackVerdict | null; reason: string | null }[], label: number): Promise<void> {
  for (const v of verdicts) {
    await db
      .update(feedback)
      .set({ reviewedAt: sql`now()`, verdict: v.verdict, verdictReason: v.reason, reviewedLabel: label })
      .where(eq(feedback.id, v.id));
  }
}

/** Feedback no reflection has read yet, oldest first, with who gave it and how much ARCHIVE-9 trusts them. */
export async function pendingFeedback(db: Database, limit = 30) {
  return db
    .select({ id: feedback.id, content: feedback.content, about: feedback.about, authorName: name, trust: relationships.trust, createdAt: feedback.createdAt })
    .from(feedback)
    .innerJoin(members, eq(members.id, feedback.authorId))
    .leftJoin(relationships, eq(relationships.memberId, feedback.authorId))
    .where(and(isNull(feedback.reviewedAt), isNull(members.optedOutAt)))
    .orderBy(asc(feedback.createdAt))
    .limit(limit);
}

export async function markFeedbackReviewed(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(feedback).set({ reviewedAt: sql`now()` }).where(inArray(feedback.id, ids));
}

/** Returns false when the member already has the maximum, or this exact preference. */
export async function addPreference(db: Database, memberId: string, content: string): Promise<boolean> {
  const current = await listPreferences(db, memberId);
  if (current.length >= PREFERENCES_PER_MEMBER || current.some((p) => p.content.toLowerCase() === content.toLowerCase())) return false;
  await db.insert(memberPreferences).values({ memberId, content });
  return true;
}

/** A member's preferences, oldest first. */
export async function listPreferences(db: Database, memberId: string) {
  return db
    .select({ id: memberPreferences.id, content: memberPreferences.content, createdAt: memberPreferences.createdAt })
    .from(memberPreferences)
    .where(eq(memberPreferences.memberId, memberId))
    .orderBy(asc(memberPreferences.createdAt));
}

export async function removePreference(db: Database, memberId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(memberPreferences)
    .where(and(eq(memberPreferences.id, id), eq(memberPreferences.memberId, memberId)))
    .returning({ id: memberPreferences.id });
  return rows.length > 0;
}

/** Preferences of everyone in a conversation, by member. */
export async function preferencesFor(db: Database, memberIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (memberIds.length === 0) return result;
  const rows = await db
    .select({ memberId: memberPreferences.memberId, content: memberPreferences.content })
    .from(memberPreferences)
    .where(inArray(memberPreferences.memberId, memberIds))
    .orderBy(asc(memberPreferences.createdAt));
  for (const row of rows) result.set(row.memberId, [...(result.get(row.memberId) ?? []), row.content]);
  return result;
}

