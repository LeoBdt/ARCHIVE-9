import type { FactNature } from "@archive-9/core";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { factCategories, factOperations, members, profileFacts, type FactOperationDetails } from "../schema.ts";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;

const isCurrent = and(isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt));

export interface FactChange {
  content?: string;
  category?: string;
  nature?: FactNature;
  confidence?: number;
  sourceMessageIds?: string[];
  reportedBy?: string | null;
}

/**
 * Writes a new version of a current fragment, keeping its number and reference; the old
 * row stays in the history. Returns the new row's ID, or null when it is no longer current.
 */
export async function supersedeFact(tx: Tx, oldId: string, change: FactChange): Promise<string | null> {
  const [old] = await tx.select().from(profileFacts).where(and(eq(profileFacts.id, oldId), isCurrent));
  if (!old) return null;
  // Out of the current set first, so the new version can take the same reference.
  await tx.update(profileFacts).set({ supersededBy: old.id }).where(eq(profileFacts.id, old.id));
  const [created] = await tx
    .insert(profileFacts)
    .values({
      ref: old.ref,
      number: old.number,
      memberId: old.memberId,
      category: change.category ?? old.category,
      nature: change.nature ?? old.nature,
      confidence: change.confidence ?? old.confidence,
      content: change.content ?? old.content,
      sourceMessageIds: change.sourceMessageIds ?? old.sourceMessageIds,
      reportedBy: change.reportedBy === undefined ? old.reportedBy : change.reportedBy,
    })
    .returning({ id: profileFacts.id });
  if (!created) throw new Error("fragment version not written");
  await tx.update(profileFacts).set({ supersededBy: created.id, updatedAt: sql`now()` }).where(eq(profileFacts.id, old.id));
  return created.id;
}

export interface DossierFact {
  id: string;
  ref: string;
  /** Arrival order of its first version, kept by every later one. */
  number: number;
  /** F001… as shown: its rank among the current fragments, so the last one gives the count. */
  rank: number;
  category: string;
  nature: FactNature;
  confidence: number;
  content: string;
  sources: number;
  reportedBy: string | null;
  createdAt: Date;
}

/** Every current fragment of a dossier, by number. */
export async function dossierFacts(db: Db, memberId: string): Promise<DossierFact[]> {
  return db
    .select({
      id: profileFacts.id,
      ref: profileFacts.ref,
      number: profileFacts.number,
      category: profileFacts.category,
      nature: profileFacts.nature,
      confidence: profileFacts.confidence,
      content: profileFacts.content,
      sources: sql<number>`cardinality(${profileFacts.sourceMessageIds})`,
      reportedBy: profileFacts.reportedBy,
      createdAt: profileFacts.createdAt,
    })
    .from(profileFacts)
    .where(and(eq(profileFacts.memberId, memberId), isCurrent))
    .orderBy(asc(profileFacts.number), asc(profileFacts.createdAt))
    .then((rows) => rows.map((r, i) => ({ ...r, rank: i + 1 })));
}

/** SQL for a fragment's rank in its dossier (F001…), among current fragments. */
export const factRank = sql<number>`(select count(*)::int from profile_facts o where o.member_id = ${profileFacts.memberId} and o.superseded_by is null and o.deleted_at is null and (o.number, o.created_at) <= (${profileFacts.number}, ${profileFacts.createdAt}))`;

/** A fragment by its reference, current version first, with its whole history. */
export async function factByRef(db: Database, ref: string) {
  const versions = await db
    .select({
      id: profileFacts.id,
      ref: profileFacts.ref,
      number: profileFacts.number,
      memberId: profileFacts.memberId,
      memberName: sql<string>`coalesce(${members.displayName}, ${members.username})`,
      category: profileFacts.category,
      categoryLabel: factCategories.label,
      nature: profileFacts.nature,
      confidence: profileFacts.confidence,
      content: profileFacts.content,
      sourceMessageIds: profileFacts.sourceMessageIds,
      reportedBy: profileFacts.reportedBy,
      current: sql<boolean>`${profileFacts.supersededBy} is null and ${profileFacts.deletedAt} is null`,
      deletedAt: profileFacts.deletedAt,
      deletedBy: profileFacts.deletedBy,
      createdAt: profileFacts.createdAt,
    })
    .from(profileFacts)
    .innerJoin(members, eq(members.id, profileFacts.memberId))
    .leftJoin(factCategories, eq(factCategories.key, profileFacts.category))
    .where(eq(profileFacts.ref, ref))
    .orderBy(desc(profileFacts.createdAt));
  if (versions.length === 0) return null;
  const operations = await db
    .select()
    .from(factOperations)
    .where(inArray(factOperations.factId, versions.map((v) => v.id)))
    .orderBy(desc(factOperations.createdAt))
    .limit(20);
  const current = versions.find((v) => v.current) ?? versions[0];
  if (!current) return null;
  return { ...current, versions, operations };
}

/** Pairs of fragments in one dossier that read almost the same, for the tidy to look at. */
export async function lookalikePairs(db: Database, memberId: string, threshold = 0.4): Promise<[string, string][]> {
  const rows = await db.execute<{ a: string; b: string }>(sql`
    select a.id as a, b.id as b from profile_facts a
    join profile_facts b on b.member_id = a.member_id and b.id > a.id and b.superseded_by is null and b.deleted_at is null
    where a.member_id = ${memberId} and a.superseded_by is null and a.deleted_at is null
      and similarity(a9_unaccent(lower(a.content)), a9_unaccent(lower(b.content))) >= ${threshold}
    limit 30`);
  return rows.map((r) => [r.a, r.b]);
}

export type FactOp = "move" | "rewrite" | "merge" | "delete" | "drawer";
export type FactOpStatus = "done" | "planned" | "applied" | "dismissed" | "failed";
export type FactOpRun = "nightly" | "cleanup" | "analysis";

export async function recordFactOperation(
  db: Db,
  input: { memberId: string; factId: string | null; op: FactOp; status: FactOpStatus; reason: string; details: FactOperationDetails; run: FactOpRun },
): Promise<string> {
  const [row] = await db.insert(factOperations).values({ ...input, reason: input.reason.slice(0, 300) }).returning({ id: factOperations.id });
  return row?.id ?? "";
}

/** Deletes a current fragment, as the tidy decided. False when it is no longer current. */
export async function deleteFact(db: Db, factId: string, by: string): Promise<boolean> {
  const rows = await db
    .update(profileFacts)
    .set({ deletedAt: sql`now()`, deletedBy: by, updatedAt: sql`now()` })
    .where(and(eq(profileFacts.id, factId), isCurrent))
    .returning({ id: profileFacts.id });
  return rows.length > 0;
}

/**
 * Folds `removeIds` into `keepId`: a new version of the kept one, with the sources of all
 * and the best confidence, then the others go. All or nothing; null when one of them changed.
 */
export async function mergeFacts(db: Database, keepId: string, removeIds: string[], content: string | null, by: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(profileFacts).where(and(inArray(profileFacts.id, [keepId, ...removeIds]), isCurrent));
    const keep = rows.find((r) => r.id === keepId);
    const others = rows.filter((r) => r.id !== keepId);
    if (!keep || others.length !== removeIds.length || others.some((o) => o.memberId !== keep.memberId)) return null;
    for (const other of others) await tx.update(profileFacts).set({ deletedAt: sql`now()`, deletedBy: by, updatedAt: sql`now()` }).where(eq(profileFacts.id, other.id));
    return supersedeFact(tx, keep.id, {
      content: content ?? keep.content,
      confidence: Math.max(keep.confidence, ...others.map((o) => o.confidence)),
      sourceMessageIds: [...new Set([...keep.sourceMessageIds, ...others.flatMap((o) => o.sourceMessageIds)])],
    });
  });
}

/** Rewrites a fragment's wording, as a new version. */
export async function rewriteFact(db: Database, factId: string, content: string): Promise<string | null> {
  return db.transaction((tx) => supersedeFact(tx, factId, { content }));
}

/** Members whose dossier the evening tidy should read: changed since its last pass, then the longest unread. */
export async function dossiersToTidy(db: Database, extra: number, selfId: string): Promise<string[]> {
  const changed = await db.execute<{ id: string }>(sql`
    select m.id from members m
    where m.opted_out_at is null and m.id <> ${selfId}
      and exists (select 1 from profile_facts f where f.member_id = m.id and f.updated_at > coalesce(m.tidied_at, '-infinity'::timestamptz))
      and (select count(*) from profile_facts f where f.member_id = m.id and f.superseded_by is null and f.deleted_at is null) >= 2`);
  const oldest = await db
    .select({ id: members.id })
    .from(members)
    .where(and(isNull(members.optedOutAt), sql`${members.id} <> ${selfId}`, sql`(select count(*) from profile_facts f where f.member_id = ${members.id} and f.superseded_by is null and f.deleted_at is null) >= 2`))
    .orderBy(sql`${members.tidiedAt} asc nulls first`)
    .limit(extra + changed.length);
  return [...new Set([...changed.map((r) => r.id), ...oldest.map((r) => r.id)])].slice(0, changed.length + extra);
}

/** Every dossier with at least two fragments, for the one-shot big tidy. */
export async function allDossiers(db: Database, selfId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select m.id from members m where m.opted_out_at is null and m.id <> ${selfId}
      and (select count(*) from profile_facts f where f.member_id = m.id and f.superseded_by is null and f.deleted_at is null) >= 2
    order by m.id`);
  return rows.map((r) => r.id);
}

export async function markTidied(db: Database, memberId: string): Promise<void> {
  await db.update(members).set({ tidiedAt: sql`now()` }).where(eq(members.id, memberId));
}

/** What the tidy did and wanted to do, newest first. */
export async function factOperationLog(db: Database, options: { status?: FactOpStatus; limit?: number } = {}) {
  return db
    .select({
      id: factOperations.id,
      memberId: factOperations.memberId,
      memberName: sql<string>`coalesce(${members.displayName}, ${members.username})`,
      factId: factOperations.factId,
      ref: sql<string | null>`(select f.ref from profile_facts f where f.id = ${factOperations.factId})`,

      op: factOperations.op,
      status: factOperations.status,
      reason: factOperations.reason,
      details: factOperations.details,
      run: factOperations.run,
      createdAt: factOperations.createdAt,
      decidedAt: factOperations.decidedAt,
      decidedBy: factOperations.decidedBy,
    })
    .from(factOperations)
    .innerJoin(members, eq(members.id, factOperations.memberId))
    .where(options.status ? eq(factOperations.status, options.status) : undefined)
    .orderBy(desc(factOperations.createdAt))
    .limit(options.limit ?? 200);
}

/**
 * Applies a merge or a deletion that waited in dry run. Re-checks that every fragment is
 * still current; otherwise it is marked failed.
 */
export async function applyPlannedOperation(db: Database, id: string, by: string): Promise<"applied" | "failed" | "not_found"> {
  const [op] = await db.select().from(factOperations).where(and(eq(factOperations.id, id), eq(factOperations.status, "planned")));
  if (!op?.factId) return "not_found";
  let ok = false;
  if (op.op === "delete") ok = await deleteFact(db, op.factId, "archive-9");
  if (op.op === "merge") ok = (await mergeFacts(db, op.factId, (op.details.merged ?? []).map((m) => m.id), op.details.after ?? null, "archive-9")) !== null;
  const status = ok ? "applied" : "failed";
  await db.update(factOperations).set({ status, decidedAt: sql`now()`, decidedBy: by }).where(eq(factOperations.id, id));
  return status;
}

export async function dismissPlannedOperation(db: Database, id: string, by: string): Promise<boolean> {
  const rows = await db
    .update(factOperations)
    .set({ status: "dismissed", decidedAt: sql`now()`, decidedBy: by })
    .where(and(eq(factOperations.id, id), eq(factOperations.status, "planned")))
    .returning({ id: factOperations.id });
  return rows.length > 0;
}

/** Old planned operations nobody looked at stop waiting after a month. */
export async function expirePlannedOperations(db: Database, before: Date): Promise<void> {
  await db
    .update(factOperations)
    .set({ status: "dismissed", decidedAt: sql`now()`, decidedBy: "expired" })
    .where(and(eq(factOperations.status, "planned"), lt(factOperations.createdAt, before)));
}

/** Counts and sizes for the Technique page. */
export async function storageStats(db: Database) {
  const [counts] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from messages) as messages,
      (select count(*)::int from messages where exists (select 1 from profile_facts f where f.source_message_ids @> array[messages.id])) as source_messages,
      (select count(*)::int from messages where guild_id is null) as dm_messages,
      (select count(*)::int from profile_facts where superseded_by is null and deleted_at is null) as facts,
      (select count(*)::int from profile_facts) as fact_rows,
      (select count(*)::int from message_images) as images,
      (select count(*)::int from message_images where description is not null) as images_described,
      (select count(*)::int from fact_categories) as drawers,
      (select count(*)::int from fact_categories where member_id is not null) as personal_drawers,
      (select count(*)::int from members where is_server = false) as members,
      (select pg_database_size(current_database()))::float8 as database_bytes,
      (select min(created_at) from messages) as oldest_message`);
  const tables = await db.execute<{ name: string; bytes: number; rows: number }>(sql`
    select c.relname as name, pg_total_relation_size(c.oid)::float8 as bytes, greatest(c.reltuples, 0)::float8 as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc limit 14`);
  return { counts: counts ?? {}, tables: [...tables] };
}

/** Members who asked for their DMs to stay out of its memory. */
export async function dmPrivateIds(db: Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, ids), sql`${members.dmPrivateAt} is not null`));
  return new Set(rows.map((r) => r.id));
}

export async function setDmPrivate(db: Database, memberId: string, enabled: boolean): Promise<void> {
  await db
    .update(members)
    .set({ dmPrivateAt: enabled ? sql`now()` : null })
    .where(eq(members.id, memberId));
}

/** The first DM gets a line saying DMs are archived; true when it still has to be said (and marks it said). */
export async function claimDmNotice(db: Database, memberId: string): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ dmNoticeAt: sql`now()` })
    .where(and(eq(members.id, memberId), isNull(members.dmNoticeAt), isNull(members.dmPrivateAt)))
    .returning({ id: members.id });
  return rows.length > 0;
}

/**
 * Forgets a member's DM conversations: every message in them (theirs and ARCHIVE-9's), and
 * the fragments learned only from there. Returns what was erased.
 */
export async function eraseDmHistory(db: Database, memberId: string): Promise<{ messages: number; facts: number }> {
  return db.transaction(async (tx) => {
    const channels = await tx.execute<{ channel_id: string }>(sql`select distinct channel_id from messages where guild_id is null and author_id = ${memberId}`);
    const ids = channels.map((c) => c.channel_id);
    if (ids.length === 0) return { messages: 0, facts: 0 };
    const inList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const facts = await tx.execute<{ id: string }>(sql`
      update profile_facts set deleted_at = now(), deleted_by = 'mp-prives', updated_at = now()
      where superseded_by is null and deleted_at is null and cardinality(source_message_ids) > 0
        and not exists (
          select 1 from unnest(source_message_ids) s(id)
          where not exists (select 1 from messages m where m.id = s.id and m.guild_id is null and m.channel_id in (${inList}))
        )
      returning id`);
    const deleted = await tx.execute<{ id: string }>(sql`delete from messages where guild_id is null and channel_id in (${inList}) returning id`);
    return { messages: deleted.length, facts: facts.length };
  });
}
