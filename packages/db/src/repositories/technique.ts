import { desc, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { capabilityGaps, feedback, members } from "../schema.ts";

/** Replies where a tool refused or failed: what it couldn't do, for the evening reflection. */
export async function difficultiesSince(db: Database, since: Date, limit = 12): Promise<{ name: string; asked: string; what: string }[]> {
  const rows = await db.execute<{ name: string; asked: string | null; steps: { tool: string; summary: string }[] | null }>(sql`
    select coalesce(m.display_name, m.username) as name, d.content as asked, d.details->'steps' as steps
    from decisions d join members m on m.id = d.author_id
    where d.created_at >= ${since.toISOString()}::timestamptz and d.addressed and d.outcome in ('replied', 'reacted', 'silent')
      and (d.details->'steps')::text ~ '"ok": ?false|refused|erreur|error'
    order by d.created_at desc limit ${limit}`);
  return rows.map((r) => ({
    name: r.name,
    asked: (r.asked ?? "").slice(0, 200),
    what: (r.steps ?? [])
      .filter((s) => /refused|false|erreur|error/.test(s.summary))
      .map((s) => `${s.tool} : ${s.summary}`)
      .join(" ; ")
      .slice(0, 300),
  }));
}

export type NoteKind = "gap" | "wish";
export type NoteStatus = "open" | "done" | "declined" | "later";

/** Notes for its creator: what it lacks, what it would like to change in itself. */
export async function addNotes(db: Database, notes: { kind: NoteKind; content: string; why: string }[], label: number | null, source: "reflection" | "conversation" = "reflection"): Promise<void> {
  if (notes.length > 0) await db.insert(capabilityGaps).values(notes.map((n) => ({ kind: n.kind, content: n.content, reason: n.why, label, source })));
}

/** Notes written today in conversations, to cap them. */
export async function notesToday(db: Database): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from capability_gaps where source = 'conversation' and created_at > now() - interval '24 hours'`);
  return row?.n ?? 0;
}

export async function notebook(db: Database, limit = 100) {
  return db.select().from(capabilityGaps).orderBy(desc(capabilityGaps.createdAt)).limit(limit);
}

/** What it reads back in the evening: notes still open, and those answered in the last two weeks. */
export async function notebookForReflection(db: Database) {
  const rows = await db.execute<{ kind: string; content: string; status: string; answer: string | null; created_at: string }>(sql`
    select kind, content, status, answer, created_at from capability_gaps
    where status in ('open', 'later') or answered_at > now() - interval '14 days'
    order by created_at desc limit 20`);
  return rows.map((r) => ({ kind: r.kind as NoteKind, content: r.content, status: r.status as NoteStatus, answer: r.answer }));
}

export async function answerNote(db: Database, id: string, status: NoteStatus, answer: string | null, by: string): Promise<boolean> {
  const rows = await db
    .update(capabilityGaps)
    .set({ status, answer: answer?.trim() ? answer.trim().slice(0, 500) : null, answeredAt: sql`now()`, answeredBy: by })
    .where(sql`${capabilityGaps.id} = ${id}`)
    .returning({ id: capabilityGaps.id });
  return rows.length > 0;
}

/** Every piece of feedback with its verdict, newest first: the full history for the admins. */
export async function feedbackHistory(db: Database, limit = 300) {
  return db
    .select({
      id: feedback.id,
      authorId: feedback.authorId,
      authorName: sql<string>`coalesce(${members.displayName}, ${members.username})`,
      content: feedback.content,
      about: feedback.about,
      source: feedback.source,
      createdAt: feedback.createdAt,
      reviewedAt: feedback.reviewedAt,
      verdict: feedback.verdict,
      verdictReason: feedback.verdictReason,
      reviewedLabel: feedback.reviewedLabel,
    })
    .from(feedback)
    .innerJoin(members, sql`${members.id} = ${feedback.authorId}`)
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

/** Skills ARCHIVE-9 gave itself. */
export async function ownSkillsSince(db: Database, selfId: string, since: Date) {
  return db.execute<{ id: string; name: string; rule: string; created_at: string }>(sql`
    select id, name, rule, created_at from skills where author_id = ${selfId} and created_at >= ${since.toISOString()}::timestamptz order by created_at desc`);
}


/** Drawers it opened, with whose they are and how full. */
export async function technicalDrawers(db: Database) {
  return db.execute<{ key: string; label: string; reason: string | null; owner: string | null; member_id: string | null; count: number; created_at: string }>(sql`
    select c.key, c.label, c.reason, coalesce(m.display_name, m.username) as owner, c.member_id, c.created_at,
      (select count(*)::int from profile_facts f where f.category = c.key and f.superseded_by is null and f.deleted_at is null) as count
    from fact_categories c left join members m on m.id = c.member_id
    where c.created_by = 'archive-9' order by c.created_at desc`);
}
