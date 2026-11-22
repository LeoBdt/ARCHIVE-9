import { inArray, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { profileSummaries, relationships } from "../schema.ts";

export interface MemberContext {
  memberId: string;
  affinity: number | null;
  trust: number | null;
  feeling: string | null;
  introduced: boolean;
  summary: string | null;
}

/** Relationship and profile summary for each participant of a conversation. */
export async function memberContexts(db: Database, ids: string[]): Promise<Map<string, MemberContext>> {
  const result = new Map<string, MemberContext>(
    ids.map((id) => [id, { memberId: id, affinity: null, trust: null, feeling: null, introduced: false, summary: null }]),
  );
  if (ids.length === 0) return result;

  const [rels, summaries] = await Promise.all([
    db.select().from(relationships).where(inArray(relationships.memberId, ids)),
    db.select().from(profileSummaries).where(inArray(profileSummaries.memberId, ids)),
  ]);
  for (const rel of rels) {
    Object.assign(result.get(rel.memberId) ?? {}, {
      affinity: rel.affinity,
      trust: rel.trust,
      feeling: rel.feeling,
      introduced: rel.introducedAt !== null,
    });
  }
  for (const summary of summaries) {
    Object.assign(result.get(summary.memberId) ?? {}, { summary: summary.summary });
  }
  return result;
}

/** Records that ARCHIVE-9 just talked to this member. The first call also marks the introduction. */
export async function recordInteraction(db: Database, memberId: string): Promise<void> {
  await db
    .insert(relationships)
    .values({ memberId, interactionCount: 1, introducedAt: sql`now()`, lastInteractionAt: sql`now()` })
    .onConflictDoUpdate({
      target: relationships.memberId,
      set: {
        interactionCount: sql`${relationships.interactionCount} + 1`,
        introducedAt: sql`coalesce(${relationships.introducedAt}, now())`,
        lastInteractionAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}
