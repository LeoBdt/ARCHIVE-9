import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { members, messages, profileFacts, profileSummaries, relationships } from "../schema.ts";

export async function profileOverview(db: Database, memberId: string) {
  const [[member], [facts], [msgs], [summary], [relation]] = await Promise.all([
    db.select().from(members).where(eq(members.id, memberId)),
    db
      .select({ n: count() })
      .from(profileFacts)
      .where(and(eq(profileFacts.memberId, memberId), isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt))),
    db.select({ n: count() }).from(messages).where(eq(messages.authorId, memberId)),
    db.select().from(profileSummaries).where(eq(profileSummaries.memberId, memberId)),
    db.select().from(relationships).where(eq(relationships.memberId, memberId)),
  ]);
  return {
    member,
    factCount: facts?.n ?? 0,
    messageCount: msgs?.n ?? 0,
    summary: summary?.summary ?? null,
    tagline: summary?.tagline ?? null,
    relationship: relation ?? null,
  };
}

/**
 * Erases everything ARCHIVE-9 knows about a member, including facts they reported about
 * others, and flags them as opted out so nothing new is stored.
 */
export async function forgetMember(db: Database, memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(messages).where(eq(messages.authorId, memberId));
    await tx.delete(profileFacts).where(or(eq(profileFacts.memberId, memberId), eq(profileFacts.reportedBy, memberId)));
    await tx.delete(profileSummaries).where(eq(profileSummaries.memberId, memberId));
    await tx.delete(relationships).where(eq(relationships.memberId, memberId));
    await tx
      .update(members)
      .set({ optedOutAt: sql`now()`, nameHistory: [] })
      .where(eq(members.id, memberId));
  });
}

export async function optBackIn(db: Database, memberId: string): Promise<void> {
  await db.update(members).set({ optedOutAt: null }).where(eq(members.id, memberId));
}
