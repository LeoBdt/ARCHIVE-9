import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client.ts";
import {
  actionsLog,
  aiUsage,
  decisions,
  feedback,
  members,
  messages,
  profileFacts,
  profileSummaries,
  relationshipEvents,
  relationships,
  selfStateVersions,
  siteAdmins,
  skills,
} from "../schema.ts";

const DAY_MS = 24 * 60 * 60_000;
const memberName = sql<string>`coalesce(${members.displayName}, ${members.username})`;
/** People the site may show: not opted out, not the server row, and bots only when they are AI agents. */
const listed = and(isNull(members.optedOutAt), eq(members.isServer, false), or(eq(members.isBot, false), eq(members.isKnownAiBot, true)));
const currentFact = and(isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt));

/** Every profile, the richest first, optionally filtered by a name (current or former). */
export async function listDossiers(db: Database, query = "", limit = 300) {
  const q = query.trim();
  const factCount = sql<number>`(select count(*)::int from profile_facts f where f.member_id = ${members.id} and f.superseded_by is null and f.deleted_at is null)`;
  const match = q
    ? or(
        ilike(members.displayName, `%${q}%`),
        ilike(members.username, `%${q}%`),
        sql`exists (select 1 from jsonb_array_elements(${members.nameHistory}) e where e->>'name' ilike ${`%${q}%`})`,
      )
    : undefined;
  return db
    .select({
      id: members.id,
      name: memberName,
      isBot: members.isBot,
      tagline: profileSummaries.tagline,
      affinity: relationships.affinity,
      facts: factCount,
      messages: sql<number>`(select count(*)::int from messages m where m.author_id = ${members.id})`,
      lastSeenAt: members.lastSeenAt,
    })
    .from(members)
    .leftJoin(profileSummaries, eq(profileSummaries.memberId, members.id))
    .leftJoin(relationships, eq(relationships.memberId, members.id))
    .where(match ? and(listed, match) : listed)
    .orderBy(desc(factCount), asc(memberName))
    .limit(limit);
}

/** A Discord link to a source message, when it is still archived in a server channel. */
function sourceLink(guildId: string | null, channelId: string | null, messageId: string | null): string | null {
  return guildId && channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null;
}

/** Everything one profile page shows. Undefined when the member isn't listed. */
export async function dossier(db: Database, memberId: string) {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), listed));
  if (!member) return undefined;
  const reporter = alias(members, "reporter");
  const source = alias(messages, "source");

  const [[summary], [relation], [counts], facts, events] = await Promise.all([
    db.select().from(profileSummaries).where(eq(profileSummaries.memberId, memberId)),
    db.select().from(relationships).where(eq(relationships.memberId, memberId)),
    db
      .select({ messages: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.authorId, memberId)),
    db
      .select({
        id: profileFacts.id,
        category: profileFacts.category,
        nature: profileFacts.nature,
        confidence: profileFacts.confidence,
        content: profileFacts.content,
        reportedByName: sql<string | null>`coalesce(${reporter.displayName}, ${reporter.username})`,
        guildId: source.guildId,
        channelId: source.channelId,
        messageId: source.id,
        createdAt: profileFacts.createdAt,
      })
      .from(profileFacts)
      .leftJoin(reporter, eq(reporter.id, profileFacts.reportedBy))
      .leftJoin(source, eq(source.id, sql`${profileFacts.sourceMessageIds}[1]`))
      .where(and(eq(profileFacts.memberId, memberId), currentFact))
      .orderBy(desc(profileFacts.confidence), desc(profileFacts.createdAt)),
    db
      .select({
        affinityDelta: relationshipEvents.affinityDelta,
        trustDelta: relationshipEvents.trustDelta,
        reason: relationshipEvents.reason,
        createdAt: relationshipEvents.createdAt,
      })
      .from(relationshipEvents)
      .where(and(eq(relationshipEvents.memberId, memberId), gte(relationshipEvents.createdAt, new Date(Date.now() - 30 * DAY_MS))))
      .orderBy(desc(relationshipEvents.createdAt)),
  ]);

  const name = member.displayName ?? member.username;
  const aliases = [...new Set([member.username, ...member.nameHistory.map((h) => h.name)])].filter((n) => n !== name);
  return {
    id: member.id,
    name,
    aliases,
    isBot: member.isBot,
    firstSeenAt: member.firstSeenAt,
    summary: summary?.summary ?? null,
    tagline: summary?.tagline ?? null,
    messages: counts?.messages ?? 0,
    relationship: relation
      ? { affinity: relation.affinity, trust: relation.trust, feeling: relation.feeling, howTheyTreatMe: relation.howTheyTreatMe }
      : null,
    facts: facts.map(({ guildId, channelId, messageId, ...f }) => ({ ...f, source: sourceLink(guildId, channelId, messageId) })),
    events: events.slice(0, 10),
    affinityHistory: affinityHistory(relation?.affinity ?? 0, events, 30),
  };
}

/** Affinity at the end of each of the last `days` days, rebuilt backwards from the current value. */
export function affinityHistory(current: number, events: { affinityDelta: number; createdAt: Date }[], days: number, now = Date.now()): number[] {
  const values: number[] = [];
  let value = current;
  for (let d = 0; d < days; d++) {
    values.unshift(value);
    const end = now - d * DAY_MS;
    const start = end - DAY_MS;
    for (const e of events) if (e.createdAt.getTime() > start && e.createdAt.getTime() <= end) value -= e.affinityDelta;
  }
  return values;
}

/** ARCHIVE-9's relationship with everyone listed, and what moved this week. */
export async function relationsOverview(db: Database) {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const people = await db
    .select({
      id: members.id,
      name: memberName,
      isBot: members.isBot,
      affinity: relationships.affinity,
      trust: relationships.trust,
      feeling: relationships.feeling,
      week: sql<number>`coalesce((select sum(e.affinity_delta)::int from relationship_events e where e.member_id = ${members.id} and e.created_at >= ${since.toISOString()}::timestamptz), 0)`,
    })
    .from(relationships)
    .innerJoin(members, eq(members.id, relationships.memberId))
    .where(listed)
    .orderBy(desc(relationships.affinity));
  const moves = await db
    .select({ name: memberName, affinityDelta: relationshipEvents.affinityDelta, trustDelta: relationshipEvents.trustDelta, reason: relationshipEvents.reason, createdAt: relationshipEvents.createdAt })
    .from(relationshipEvents)
    .innerJoin(members, eq(members.id, relationshipEvents.memberId))
    .where(and(listed, gte(relationshipEvents.createdAt, since)))
    .orderBy(desc(relationshipEvents.createdAt))
    .limit(20);
  return { people, moves };
}

/** Its self state over time and the feedback it hasn't weighed yet. */
export async function memoryOverview(db: Database, versions = 30) {
  const history = await db
    .select({ version: selfStateVersions.version, state: selfStateVersions.state, source: selfStateVersions.source, createdAt: selfStateVersions.createdAt })
    .from(selfStateVersions)
    .orderBy(desc(selfStateVersions.version))
    .limit(versions);
  const pending = await db
    .select({ author: memberName, content: feedback.content, createdAt: feedback.createdAt })
    .from(feedback)
    .innerJoin(members, eq(members.id, feedback.authorId))
    .where(and(isNull(feedback.reviewedAt), isNull(members.optedOutAt)))
    .orderBy(asc(feedback.createdAt));
  return { history, pending };
}

/** Every skill in use, with its author. */
export async function skillsOverview(db: Database) {
  return db
    .select({
      id: skills.id,
      name: skills.name,
      kind: skills.kind,
      triggers: skills.triggers,
      rule: skills.rule,
      author: sql<string | null>`coalesce(${members.displayName}, ${members.username})`,
      uses: skills.usageCount,
      lastUsedAt: skills.lastUsedAt,
      expiresAt: skills.expiresAt,
      createdAt: skills.createdAt,
    })
    .from(skills)
    .leftJoin(members, eq(members.id, skills.authorId))
    .where(and(isNull(skills.deletedAt), sql`(${skills.expiresAt} is null or ${skills.expiresAt} > now())`))
    .orderBy(desc(skills.usageCount), desc(skills.createdAt));
}

/** Everything ARCHIVE-9 did or refused to do on the server, newest first. */
export async function actionJournal(db: Database, limit = 100) {
  return db
    .select({
      id: actionsLog.id,
      tool: actionsLog.tool,
      tier: actionsLog.tier,
      params: actionsLog.params,
      status: actionsLog.status,
      refusalReason: actionsLog.refusalReason,
      requestedBy: sql<string | null>`coalesce(${members.displayName}, ${members.username})`,
      createdAt: actionsLog.createdAt,
      undoneAt: actionsLog.undoneAt,
    })
    .from(actionsLog)
    .leftJoin(members, eq(members.id, actionsLog.requestedBy))
    .where(inArray(actionsLog.status, ["done", "refused", "failed", "undone"]))
    .orderBy(desc(actionsLog.createdAt))
    .limit(limit);
}

const author = alias(members, "author");
const authorName = sql<string>`coalesce(${author.displayName}, ${author.username}, 'quelqu''un')`;

/** Its replies with their « why » and the cost of each run. DMs only for their member, or admins. */
export async function replyJournal(db: Database, viewer: { id: string; isAdmin: boolean }, limit = 60) {
  const dm = viewer.isAdmin ? sql`true` : sql`(${decisions.guildId} is not null or ${decisions.authorId} = ${viewer.id})`;
  const rows = await db
    .select({
      id: decisions.id,
      runId: decisions.runId,
      outcome: decisions.outcome,
      reason: decisions.reason,
      channelName: decisions.channelName,
      isDm: sql<boolean>`${decisions.guildId} is null`,
      authorName,
      content: decisions.content,
      details: decisions.details,
      createdAt: decisions.createdAt,
    })
    .from(decisions)
    .leftJoin(author, eq(author.id, decisions.authorId))
    .where(and(inArray(decisions.outcome, ["replied", "reacted", "silent", "offline"]), sql`(${decisions.addressed} or ${decisions.outcome} <> 'silent')`, dm))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);
  const runIds = rows.flatMap((r) => (r.runId ? [r.runId] : []));
  const usage = runIds.length
    ? await db
        .select({
          runId: aiUsage.runId,
          model: sql<string>`(array_agg(${aiUsage.model} order by ${aiUsage.createdAt} desc) filter (where ${aiUsage.task} = 'reply'))[1]`,
          provider: sql<string | null>`(array_agg(coalesce(${aiUsage.upstreamProvider}, ${aiUsage.provider}) order by ${aiUsage.createdAt} desc) filter (where ${aiUsage.task} = 'reply'))[1]`,
          fallbackReason: sql<string | null>`max(${aiUsage.fallbackReason})`,
          inputTokens: sql<number>`sum(${aiUsage.inputTokens})::int`,
          outputTokens: sql<number>`sum(${aiUsage.outputTokens})::int`,
          reasoningTokens: sql<number>`sum(${aiUsage.reasoningTokens})::int`,
          costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
          durationMs: sql<number>`sum(${aiUsage.durationMs})::int`,
        })
        .from(aiUsage)
        .where(inArray(aiUsage.runId, runIds))
        .groupBy(aiUsage.runId)
    : [];
  const byRun = new Map(usage.map((u) => [u.runId, u]));
  return rows.map(({ runId, ...r }) => ({ ...r, usage: runId ? (byRun.get(runId) ?? null) : null }));
}

/** The backstage page: the triage of everything it didn't answer, costs, ignored messages, errors. Public. */
export async function backstage(db: Database) {
  const since = new Date(Date.now() - DAY_MS);
  const [[today], triage, costs, ignored, errors, [speed]] = await Promise.all([
    db
      .select({
        seen: sql<number>`count(*)::int`,
        replies: sql<number>`count(*) filter (where ${decisions.outcome} = 'replied')::int`,
      })
      .from(decisions)
      .where(gte(decisions.createdAt, since)),
    db
      .select({
        outcome: decisions.outcome,
        reason: decisions.reason,
        interest: decisions.interest,
        channelName: decisions.channelName,
        isDm: sql<boolean>`${decisions.guildId} is null`,
        authorName,
        createdAt: decisions.createdAt,
      })
      .from(decisions)
      .leftJoin(author, eq(author.id, decisions.authorId))
      .where(or(eq(decisions.outcome, "ignored"), and(eq(decisions.outcome, "silent"), eq(decisions.addressed, false))))
      .orderBy(desc(decisions.createdAt))
      .limit(60),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${aiUsage.createdAt} at time zone 'Europe/Paris'), 'YYYY-MM-DD')`,
        task: aiUsage.task,
        costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, new Date(Date.now() - 7 * DAY_MS)))
      .groupBy(sql`1`, aiUsage.task)
      .orderBy(sql`1`),
    db
      .select({ reason: decisions.reason, n: sql<number>`count(*)::int` })
      .from(decisions)
      .where(and(eq(decisions.outcome, "ignored"), gte(decisions.createdAt, since)))
      .groupBy(decisions.reason)
      .orderBy(desc(sql`2`)),
    db
      .select({ model: aiUsage.model, task: aiUsage.task, status: aiUsage.status, fallbackReason: aiUsage.fallbackReason, createdAt: aiUsage.createdAt })
      .from(aiUsage)
      .where(and(gte(aiUsage.createdAt, since), or(sql`${aiUsage.status} <> 'ok'`, sql`${aiUsage.fallbackReason} is not null`)))
      .orderBy(desc(aiUsage.createdAt))
      .limit(20),
    db
      .select({ median: sql<number | null>`percentile_cont(0.5) within group (order by ${aiUsage.durationMs})` })
      .from(aiUsage)
      .where(and(eq(aiUsage.task, "reply"), eq(aiUsage.status, "ok"), gte(aiUsage.createdAt, since))),
  ]);
  const spent = costs.filter((c) => c.day >= new Date(Date.now() - DAY_MS).toISOString().slice(0, 10)).reduce((sum, c) => sum + c.costUsd, 0);
  return {
    today: { seen: today?.seen ?? 0, replies: today?.replies ?? 0, medianMs: speed?.median ?? null, spentToday: spent },
    triage: triage.map((t) => (t.isDm ? { ...t, authorName: null, channelName: null, reason: t.outcome === "ignored" ? t.reason : null } : t)),
    costs,
    ignored,
    errors,
  };
}

/** Members the owner can name admin, with who already is. */
export async function accessList(db: Database) {
  return db
    .select({ id: members.id, name: memberName, isAdmin: sql<boolean>`exists (select 1 from site_admins a where a.member_id = ${members.id})` })
    .from(members)
    .where(and(isNull(members.optedOutAt), eq(members.isServer, false), eq(members.isBot, false), eq(members.inGuild, true)))
    .orderBy(asc(memberName));
}

export async function revokeSiteAdmin(db: Database, memberId: string): Promise<void> {
  await db.delete(siteAdmins).where(eq(siteAdmins.memberId, memberId));
}

/** Puts an older self state back, as a new version: the history keeps everything. */
export async function rollbackSelfState(db: Database, version: number, by: string): Promise<number | null> {
  const [old] = await db.select({ state: selfStateVersions.state }).from(selfStateVersions).where(eq(selfStateVersions.version, version));
  if (!old) return null;
  const [row] = await db.insert(selfStateVersions).values({ state: old.state, source: "rollback", createdBy: by }).returning({ version: selfStateVersions.version });
  return row?.version ?? null;
}
