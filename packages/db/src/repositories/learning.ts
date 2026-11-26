import { AFFINITY_RANGE, TRUST_RANGE, TRUST_START, applyAffinity, applyTrust, capDelta, type FactCategory, type FactNature } from "@archive-9/core";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client.ts";
import { supersedeFact } from "./fragments.ts";
import { factCorrections, members, messages, profileFacts, profileSummaries, relationshipEvents, relationships } from "../schema.ts";

export interface CurrentFact {
  id: string;
  /** #K7QX3M */
  ref: string;
  /** Arrival order in the dossier; the F shown is the rank. */
  number: number;
  memberId: string;
  category: FactCategory;
  nature: FactNature;
  confidence: number;
  content: string;
  reportedByName: string | null;
  createdAt: Date;
}

export interface ParticipantProfile {
  id: string;
  name: string;
  isBot: boolean;
  isKnownAiBot: boolean;
  isServer: boolean;
  summary: string | null;
  affinity: number | null;
  trust: number | null;
  feeling: string | null;
  facts: CurrentFact[];
  /** What they took off their own profile, newest first. */
  removed: Correction[];
}

const isCurrent = and(isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt));

async function selectFacts(db: Database, where: ReturnType<typeof and>, limit: number): Promise<CurrentFact[]> {
  const reporter = alias(members, "reporter");
  return db
    .select({
      id: profileFacts.id,
      ref: profileFacts.ref,
      number: profileFacts.number,
      memberId: profileFacts.memberId,
      category: profileFacts.category,
      nature: profileFacts.nature,
      confidence: profileFacts.confidence,
      content: profileFacts.content,
      reportedByName: sql<string | null>`coalesce(${reporter.displayName}, ${reporter.username})`,
      createdAt: profileFacts.createdAt,
    })
    .from(profileFacts)
    .leftJoin(reporter, eq(reporter.id, profileFacts.reportedBy))
    .where(where)
    .orderBy(desc(profileFacts.createdAt))
    .limit(limit);
}

/** Current facts about a member, most recent first. */
export async function currentFacts(db: Database, memberId: string, limit: number): Promise<CurrentFact[]> {
  return selectFacts(db, and(eq(profileFacts.memberId, memberId), isCurrent), limit);
}

/** Facts learned since `since`, most recent first, with the member's name. */
export async function factsSince(db: Database, since: Date, limit: number) {
  const facts = await selectFacts(db, and(gte(profileFacts.createdAt, since), isCurrent), limit);
  const names = await memberNames(db, [...new Set(facts.map((f) => f.memberId))]);
  return facts.map((f) => ({ ...f, memberName: names.get(f.memberId) ?? f.memberId }));
}

export async function memberNames(db: Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: members.id, username: members.username, displayName: members.displayName })
    .from(members)
    .where(inArray(members.id, ids));
  return new Map(rows.map((row) => [row.id, row.displayName ?? row.username]));
}

/**
 * What ARCHIVE-9 already knows about each participant of a batch. Opted-out and unknown
 * members are left out, so nothing can be learned about them.
 */
export async function participantProfiles(db: Database, ids: string[], factsPerMember: number): Promise<ParticipantProfile[]> {
  if (ids.length === 0) return [];
  const [people, summaries, relations, facts, corrections] = await Promise.all([
    db
      .select()
      .from(members)
      .where(and(inArray(members.id, ids), isNull(members.optedOutAt))),
    db.select().from(profileSummaries).where(inArray(profileSummaries.memberId, ids)),
    db.select().from(relationships).where(inArray(relationships.memberId, ids)),
    selectFacts(db, and(inArray(profileFacts.memberId, ids), isCurrent), 5_000),
    recentCorrections(db, ids),
  ]);
  const summaryOf = new Map(summaries.map((s) => [s.memberId, s.summary]));
  const relationOf = new Map(relations.map((r) => [r.memberId, r]));
  return people.map((person) => {
    const relation = relationOf.get(person.id);
    return {
      id: person.id,
      name: person.displayName ?? person.username,
      isBot: person.isBot,
      isKnownAiBot: person.isKnownAiBot,
      isServer: person.isServer,
      summary: summaryOf.get(person.id) ?? null,
      affinity: relation?.affinity ?? null,
      trust: relation?.trust ?? null,
      feeling: relation?.feeling ?? null,
      facts: facts.filter((f) => f.memberId === person.id).slice(0, factsPerMember),
      removed: corrections.get(person.id) ?? [],
    };
  });
}

export interface AnalysisWrite {
  facts: {
    memberId: string;
    category: FactCategory;
    nature: FactNature;
    confidence: number;
    content: string;
    sourceMessageIds: string[];
    reportedBy: string | null;
    replacesId: string | null;
  }[];
  retractions: { factId: string; memberId: string }[];
  relationships: {
    memberId: string;
    affinityDelta: number;
    trustDelta: number;
    reason: string;
    sourceMessageId: string | null;
    feeling: string | null;
    howTheyTreatMe: string | null;
  }[];
  analysedIds: string[];
  /** When the conversations happened. Daily relationship caps are counted from there. */
  at: Date;
}

/**
 * Writes the outcome of one analysis batch in a single transaction and marks its messages
 * as analysed. Returns the members whose facts changed.
 */
export async function applyAnalysis(db: Database, write: AnalysisWrite): Promise<string[]> {
  return db.transaction(async (tx) => {
    const ids = [...new Set([...write.facts.map((f) => f.memberId), ...write.relationships.map((r) => r.memberId)])];
    const optedOut = new Set(
      ids.length === 0
        ? []
        : (
            await tx
              .select({ id: members.id })
              .from(members)
              .where(and(inArray(members.id, ids), isNotNull(members.optedOutAt)))
          ).map((row) => row.id),
    );
    const touched = new Set<string>();

    for (const fact of write.facts) {
      if (optedOut.has(fact.memberId) || (fact.reportedBy && optedOut.has(fact.reportedBy))) continue;
      const { replacesId, ...values } = fact;
      if (!replacesId) {
        // Already known in other words: the existing fragment gets the new sources instead.
        const twin = await nearDuplicate(tx, fact.memberId, fact.content);
        if (twin) {
          await tx
            .update(profileFacts)
            .set({
              sourceMessageIds: sql`(select array(select distinct unnest(${profileFacts.sourceMessageIds} || ${sql.param(fact.sourceMessageIds)}::text[])))`,
              confidence: sql`greatest(${profileFacts.confidence}, ${fact.confidence})`,
              updatedAt: sql`now()`,
            })
            .where(eq(profileFacts.id, twin));
          continue;
        }
      }
      // A new version keeps the number and reference of the one it replaces.
      const [old] = replacesId
        ? await tx.select({ id: profileFacts.id }).from(profileFacts).where(and(eq(profileFacts.id, replacesId), eq(profileFacts.memberId, fact.memberId), isCurrent))
        : [];
      if (old) await supersedeFact(tx, old.id, values);
      else await tx.insert(profileFacts).values(values);
      touched.add(fact.memberId);
    }

    for (const retraction of write.retractions) {
      const done = await tx
        .update(profileFacts)
        .set({ deletedAt: sql`now()`, deletedBy: retraction.memberId, updatedAt: sql`now()` })
        .where(and(eq(profileFacts.id, retraction.factId), eq(profileFacts.memberId, retraction.memberId), isCurrent))
        .returning({ id: profileFacts.id });
      if (done.length > 0) touched.add(retraction.memberId);
    }

    const dayStart = new Date(write.at.getTime() - 24 * 60 * 60_000);
    for (const update of write.relationships) {
      if (optedOut.has(update.memberId)) continue;
      const [sums] = await tx
        .select({
          affinity: sql<number>`coalesce(sum(${relationshipEvents.affinityDelta}), 0)::float8`,
          trust: sql<number>`coalesce(sum(${relationshipEvents.trustDelta}), 0)::float8`,
        })
        .from(relationshipEvents)
        .where(
          and(
            eq(relationshipEvents.memberId, update.memberId),
            gt(relationshipEvents.createdAt, dayStart),
            lte(relationshipEvents.createdAt, write.at),
          ),
        );
      const affinity = capDelta(update.affinityDelta, sums?.affinity ?? 0);
      const trust = capDelta(update.trustDelta, sums?.trust ?? 0);
      if (affinity === 0 && trust === 0 && !update.feeling && !update.howTheyTreatMe) continue;

      await tx
        .insert(relationships)
        .values({
          memberId: update.memberId,
          affinity: applyAffinity(0, affinity),
          trust: applyTrust(TRUST_START, trust),
          feeling: update.feeling,
          howTheyTreatMe: update.howTheyTreatMe,
        })
        .onConflictDoUpdate({
          target: relationships.memberId,
          set: {
            affinity: sql`greatest(${AFFINITY_RANGE.min}, least(${AFFINITY_RANGE.max}, ${relationships.affinity} + ${affinity}))`,
            trust: sql`greatest(${TRUST_RANGE.min}, least(${TRUST_RANGE.max}, ${relationships.trust} + ${trust}))`,
            feeling: sql`coalesce(excluded.feeling, ${relationships.feeling})`,
            howTheyTreatMe: sql`coalesce(excluded.how_they_treat_me, ${relationships.howTheyTreatMe})`,
            updatedAt: sql`now()`,
          },
        });
      if (affinity !== 0 || trust !== 0) {
        await tx.insert(relationshipEvents).values({
          memberId: update.memberId,
          affinityDelta: affinity,
          trustDelta: trust,
          reason: update.reason,
          sourceMessageId: update.sourceMessageId,
          createdAt: write.at,
        });
      }
    }

    if (write.analysedIds.length > 0) {
      await tx.update(messages).set({ analysedAt: sql`now()` }).where(inArray(messages.id, write.analysedIds));
    }
    return [...touched];
  });
}

export async function relationshipEventsSince(db: Database, since: Date, limit: number) {
  const rows = await db
    .select({
      memberId: relationshipEvents.memberId,
      affinityDelta: relationshipEvents.affinityDelta,
      trustDelta: relationshipEvents.trustDelta,
      reason: relationshipEvents.reason,
      createdAt: relationshipEvents.createdAt,
    })
    .from(relationshipEvents)
    .where(gte(relationshipEvents.createdAt, since))
    .orderBy(desc(relationshipEvents.createdAt))
    .limit(limit);
  const names = await memberNames(db, [...new Set(rows.map((r) => r.memberId))]);
  return rows.map((r) => ({ ...r, memberName: names.get(r.memberId) ?? r.memberId }));
}

export interface SummaryWrite {
  memberId: string;
  summary: string;
  tagline: string | null;
  factCount: number;
  model: string;
}

export async function saveSummary(db: Database, write: SummaryWrite): Promise<void> {
  await db
    .insert(profileSummaries)
    .values(write)
    .onConflictDoUpdate({
      target: profileSummaries.memberId,
      set: { summary: write.summary, tagline: write.tagline, factCount: write.factCount, model: write.model, generatedAt: sql`now()` },
    });
}

export async function deleteSummary(db: Database, memberId: string): Promise<void> {
  await db.delete(profileSummaries).where(eq(profileSummaries.memberId, memberId));
}

export interface Correction {
  content: string;
  /** Set when the member rewrote the fact rather than removing it. */
  newContent: string | null;
  reason: string;
}

/**
 * Takes facts off a member's own profile. Only their current facts can go; the rest of
 * `factIds` is ignored. Returns what was removed.
 */
export async function forgetOwnFacts(db: Database, memberId: string, factIds: string[], reason: string, source: "discord" | "site", by: string | null = null): Promise<string[]> {
  if (factIds.length === 0) return [];
  return db.transaction(async (tx) => {
    const removed = await tx
      .update(profileFacts)
      .set({ deletedAt: sql`now()`, deletedBy: memberId })
      .where(and(inArray(profileFacts.id, factIds), eq(profileFacts.memberId, memberId), isCurrent))
      .returning({ id: profileFacts.id, content: profileFacts.content });
    if (removed.length > 0) {
      await tx.insert(factCorrections).values(removed.map((f) => ({ memberId, factId: f.id, content: f.content, reason, source, by })));
    }
    return removed.map((f) => f.content);
  });
}

/**
 * Replaces one of a member's own facts by their version. The old one is superseded, so it
 * stays in the history; the new one counts as said by them. Null when the fact isn't theirs.
 */
export async function correctOwnFact(db: Database, memberId: string, factId: string, newContent: string, reason: string, source: "discord" | "site", by: string | null = null) {
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(profileFacts)
      .where(and(eq(profileFacts.id, factId), eq(profileFacts.memberId, memberId), isCurrent));
    if (!old) return null;
    const newId = await supersedeFact(tx, old.id, { nature: "fact", confidence: 0.95, content: newContent, sourceMessageIds: [], reportedBy: null });
    if (!newId) return null;
    await tx.insert(factCorrections).values({ memberId, factId: old.id, content: old.content, newContent, reason, source, by });
    return { before: old.content, after: newContent, newId, category: old.category };
  });
}

/** Last corrections of each member, for the analysis not to learn them again. */
export async function recentCorrections(db: Database, memberIds: string[], perMember = 10): Promise<Map<string, Correction[]>> {
  const result = new Map<string, Correction[]>();
  if (memberIds.length === 0) return result;
  const rows = await db
    .select({ memberId: factCorrections.memberId, content: factCorrections.content, newContent: factCorrections.newContent, reason: factCorrections.reason })
    .from(factCorrections)
    .where(inArray(factCorrections.memberId, memberIds))
    .orderBy(desc(factCorrections.createdAt));
  for (const row of rows) {
    const list = result.get(row.memberId) ?? [];
    if (list.length < perMember) list.push({ content: row.content, newContent: row.newContent, reason: row.reason });
    result.set(row.memberId, list);
  }
  return result;
}

/**
 * Members whose summary was written before a correction or a removal: it may still show what
 * is gone (their own corrections, the tidy, /mp-prives).
 */
export async function summariesToRefresh(db: Database): Promise<string[]> {
  const rows = await db
    .select({ memberId: profileSummaries.memberId })
    .from(profileSummaries)
    .where(
      sql`exists (select 1 from ${factCorrections} c where c.member_id = ${profileSummaries.memberId} and c.created_at > ${profileSummaries.generatedAt})
        or exists (select 1 from ${profileFacts} f where f.member_id = ${profileSummaries.memberId} and f.deleted_at > ${profileSummaries.generatedAt})`,
    );
  return rows.map((r) => r.memberId);
}

/** Trigram likeness from which two fragments of one person count as the same thing said twice. */
export const DUPLICATE_SIMILARITY = 0.6;

/** A current fragment of this person saying nearly the same thing, if any. */
export async function nearDuplicate(db: Pick<Database, "execute">, memberId: string, content: string): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    select id from profile_facts
    where member_id = ${memberId} and superseded_by is null and deleted_at is null
      and similarity(a9_unaccent(lower(content)), a9_unaccent(lower(${content}))) >= ${DUPLICATE_SIMILARITY}
    order by similarity(a9_unaccent(lower(content)), a9_unaccent(lower(${content}))) desc
    limit 1`);
  return rows[0]?.id ?? null;
}

/** Whose profile a current fact belongs to, or undefined. */
export async function factOwner(db: Database, factId: string): Promise<string | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(factId)) return undefined;
  const [row] = await db
    .select({ memberId: profileFacts.memberId })
    .from(profileFacts)
    .where(and(eq(profileFacts.id, factId), isCurrent));
  return row?.memberId;
}
