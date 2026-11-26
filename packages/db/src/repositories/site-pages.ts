import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client.ts";
import {
  actionsLog,
  aiUsage,
  decisions,
  factCategories,
  factCorrections,
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
import { latestReleases } from "./releases.ts";
import { saveSelfState } from "./self-state.ts";

const DAY_MS = 24 * 60 * 60_000;
const memberName = sql<string>`coalesce(${members.displayName}, ${members.username})`;
/** People the site may show: not opted out, not the server row, and bots only when they are AI agents. */
const listed = and(isNull(members.optedOutAt), eq(members.isServer, false), or(eq(members.isBot, false), eq(members.isKnownAiBot, true)));
const currentFact = and(isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt));

const aliasesOf = (m: { username: string; displayName: string | null; nameHistory: { name: string }[] }) => {
  const name = m.displayName ?? m.username;
  return [...new Set([m.username, ...m.nameHistory.map((h) => h.name)])].filter((n) => n !== name);
};

/** Every profile, for the archives page: it searches and sorts on its own. */
export async function listDossiers(db: Database, query = "", limit = 400) {
  const q = query.trim().toLowerCase();
  const rows = await db
    .select({
      id: members.id,
      username: members.username,
      displayName: members.displayName,
      nameHistory: members.nameHistory,
      isBot: members.isBot,
      avatar: members.avatar,
      firstSeenAt: members.firstSeenAt,
      tagline: profileSummaries.tagline,
      affinity: relationships.affinity,
      trust: relationships.trust,
      facts: sql<number>`(select count(*)::int from profile_facts f where f.member_id = ${members.id} and f.superseded_by is null and f.deleted_at is null)`,
      messages: sql<number>`(select count(*)::int from messages m where m.author_id = ${members.id})`,
      changedAt: sql<string | null>`(select max(f.updated_at) from profile_facts f where f.member_id = ${members.id})`,
    })
    .from(members)
    .leftJoin(profileSummaries, eq(profileSummaries.memberId, members.id))
    .leftJoin(relationships, eq(relationships.memberId, members.id))
    .where(listed)
    .orderBy(asc(memberName))
    .limit(limit);
  const list = rows.map(({ username, displayName, nameHistory, ...r }) => ({ ...r, name: displayName ?? username, aliases: aliasesOf({ username, displayName, nameHistory }) }));
  return q ? list.filter((d) => [d.name, ...d.aliases].some((n) => n.toLowerCase().includes(q))) : list;
}

/** A Discord link to a source message, when it is still archived in a server channel. */
function sourceLink(guildId: string | null, channelId: string | null, messageId: string | null): string | null {
  return guildId && channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null;
}

export async function listFactCategories(db: Database) {
  return db.select().from(factCategories).orderBy(asc(factCategories.createdAt), asc(factCategories.key));
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
  const since = new Date(Date.now() - 30 * DAY_MS);

  const [[summary], [relation], [counts], facts, events, categories] = await Promise.all([
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
        messageId: sql<string | null>`${profileFacts.sourceMessageIds}[1]`,
        archived: sql<boolean>`${source.id} is not null`,
        ref: profileFacts.ref,
        // F001, F002…: its rank among the current fragments, so the last one is the count.
        number: sql<number>`(select count(*)::int from profile_facts o where o.member_id = ${profileFacts.memberId} and o.superseded_by is null and o.deleted_at is null and (o.number, o.created_at) <= (${profileFacts.number}, ${profileFacts.createdAt}))`,
        createdAt: profileFacts.createdAt,
        // The member's (or an admin's) correction that produced this fact, if any.
        corrected: sql<{ at: string; by: string | null; reason: string } | null>`(
          select json_build_object('at', c.created_at, 'by', coalesce(b.display_name, b.username), 'reason', c.reason)
          from profile_facts old join fact_corrections c on c.fact_id = old.id left join members b on b.id = c.by
          where old.superseded_by = ${profileFacts.id} order by c.created_at desc limit 1)`,
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
        sourceMessageId: relationshipEvents.sourceMessageId,
        createdAt: relationshipEvents.createdAt,
      })
      .from(relationshipEvents)
      .where(and(eq(relationshipEvents.memberId, memberId), gte(relationshipEvents.createdAt, since)))
      .orderBy(desc(relationshipEvents.createdAt)),
    listFactCategories(db),
  ]);

  const name = member.displayName ?? member.username;
  return {
    id: member.id,
    name,
    aliases: aliasesOf(member),
    isBot: member.isBot,
    avatar: member.avatar,
    firstSeenAt: member.firstSeenAt,
    summary: summary?.summary ?? null,
    tagline: summary?.tagline ?? null,
    summaryAt: summary?.generatedAt ?? null,
    messages: counts?.messages ?? 0,
    relationship: relation
      ? { affinity: relation.affinity, trust: relation.trust, feeling: relation.feeling, howTheyTreatMe: relation.howTheyTreatMe }
      : null,
    facts: facts.map(({ guildId, channelId, messageId, archived, ...f }) => ({
      ...f,
      sourceMessageId: archived ? messageId : null,
      source: sourceLink(guildId, channelId, messageId),
    })),
    categories: categories
      .filter((c) => c.memberId === null || c.memberId === memberId)
      .map((c) => ({ key: c.key, label: c.label, color: c.color, createdBy: c.createdBy, createdAt: c.createdAt, personal: c.memberId !== null, reason: c.reason })),
    events: events.slice(0, 12),
    affinityHistory: affinityHistory(relation?.affinity ?? 0, events, 30),
    history: relationHistory({ affinity: relation?.affinity ?? 0, trust: relation?.trust ?? 50 }, events, 30),
    changedAt: facts.reduce<Date | null>((max, f) => (!max || f.createdAt > max ? f.createdAt : max), null),
  };
}

/** Affinity at the end of each of the last `days` days, rebuilt backwards from the current value. */
export function affinityHistory(current: number, events: { affinityDelta: number; createdAt: Date }[], days: number, now = Date.now()): number[] {
  return relationHistory({ affinity: current, trust: 0 }, events.map((e) => ({ ...e, trustDelta: 0 })), days, now).map((d) => d.affinity);
}

/** Affinity and trust at the end of each of the last `days` days, newest last. */
export function relationHistory(
  current: { affinity: number; trust: number },
  events: { affinityDelta: number; trustDelta: number; createdAt: Date }[],
  days: number,
  now = Date.now(),
): { day: string; affinity: number; trust: number }[] {
  const values: { day: string; affinity: number; trust: number }[] = [];
  let { affinity, trust } = current;
  for (let d = 0; d < days; d++) {
    const end = now - d * DAY_MS;
    values.unshift({ day: new Date(end).toISOString().slice(0, 10), affinity, trust });
    const start = end - DAY_MS;
    for (const e of events) {
      const t = e.createdAt.getTime();
      if (t > start && t <= end) {
        affinity -= e.affinityDelta;
        trust -= e.trustDelta;
      }
    }
  }
  return values;
}

/**
 * The archived message behind a fragment or an event, with two messages around it. Only
 * public channels show their content; a DM only to its own author.
 */
export async function messageContext(db: Database, messageId: string, viewerId: string, publicChannels: ReadonlySet<string>, channelNames: ReadonlyMap<string, string>) {
  const [target] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!target) return { found: false as const };
  const link = sourceLink(target.guildId, target.channelId, target.id);
  const channelName = target.guildId === null ? null : (channelNames.get(target.channelId) ?? null);
  const visible = target.guildId === null ? target.authorId === viewerId : publicChannels.has(target.channelId);
  const base = { found: true as const, isDm: target.guildId === null, channelName, link, at: target.createdAt };
  if (!visible) return { ...base, hidden: true as const, messages: [] };
  const around = (dir: "before" | "after") =>
    db
      .select({ id: messages.id, authorId: messages.authorId, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.channelId, target.channelId), dir === "before" ? sql`${messages.createdAt} < ${target.createdAt.toISOString()}::timestamptz` : sql`${messages.createdAt} > ${target.createdAt.toISOString()}::timestamptz`))
      .orderBy(dir === "before" ? desc(messages.createdAt) : asc(messages.createdAt))
      .limit(2);
  const [before, after] = await Promise.all([around("before"), around("after")]);
  const list = [...before.reverse(), { id: target.id, authorId: target.authorId, content: target.content, createdAt: target.createdAt }, ...after];
  const names = await db
    .select({ id: members.id, name: memberName, optedOut: sql<boolean>`${members.optedOutAt} is not null` })
    .from(members)
    .where(inArray(members.id, [...new Set(list.map((m) => m.authorId))]));
  const byId = new Map(names.map((n) => [n.id, n]));
  return {
    ...base,
    hidden: false as const,
    messages: list
      .filter((m) => !byId.get(m.authorId)?.optedOut)
      .map((m) => ({ id: m.id, author: byId.get(m.authorId)?.name ?? "quelqu'un", content: m.content.slice(0, 600), at: m.createdAt, isTarget: m.id === target.id })),
  };
}

/** ARCHIVE-9's relationship with everyone listed, and what moved this week. */
export async function relationsOverview(db: Database) {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const iso = since.toISOString();
  const people = await db
    .select({
      id: members.id,
      name: memberName,
      isBot: members.isBot,
      avatar: members.avatar,
      affinity: relationships.affinity,
      trust: relationships.trust,
      feeling: relationships.feeling,
      week: sql<number>`coalesce((select sum(e.affinity_delta)::float8 from relationship_events e where e.member_id = ${members.id} and e.created_at >= ${iso}::timestamptz), 0)`,
      weekTrust: sql<number>`coalesce((select sum(e.trust_delta)::float8 from relationship_events e where e.member_id = ${members.id} and e.created_at >= ${iso}::timestamptz), 0)`,
      changedAt: relationships.updatedAt,
    })
    .from(relationships)
    .innerJoin(members, eq(members.id, relationships.memberId))
    .where(listed)
    .orderBy(desc(relationships.affinity));
  const moves = await db
    .select({
      memberId: relationshipEvents.memberId,
      name: memberName,
      avatar: members.avatar,
      affinityDelta: relationshipEvents.affinityDelta,
      trustDelta: relationshipEvents.trustDelta,
      reason: relationshipEvents.reason,
      sourceMessageId: relationshipEvents.sourceMessageId,
      createdAt: relationshipEvents.createdAt,
    })
    .from(relationshipEvents)
    .innerJoin(members, eq(members.id, relationshipEvents.memberId))
    .where(and(listed, gte(relationshipEvents.createdAt, since)))
    .orderBy(desc(relationshipEvents.createdAt))
    .limit(40);
  return { people, moves };
}

/** Its self state over time, the feedback it hasn't weighed yet, and what it decided about the rest. */
export async function memoryOverview(db: Database, versions = 30) {
  const [history, pending, reviewed] = await Promise.all([
    db
      .select({ version: selfStateVersions.version, label: selfStateVersions.label, state: selfStateVersions.state, source: selfStateVersions.source, createdAt: selfStateVersions.createdAt })
      .from(selfStateVersions)
      .orderBy(desc(selfStateVersions.version))
      .limit(versions),
    db
      .select({ id: feedback.id, author: memberName, content: feedback.content, about: feedback.about, source: feedback.source, createdAt: feedback.createdAt })
      .from(feedback)
      .innerJoin(members, eq(members.id, feedback.authorId))
      .where(and(isNull(feedback.reviewedAt), isNull(members.optedOutAt)))
      .orderBy(asc(feedback.createdAt)),
    db
      .select({
        id: feedback.id,
        author: memberName,
        content: feedback.content,
        about: feedback.about,
        source: feedback.source,
        verdict: feedback.verdict,
        verdictReason: feedback.verdictReason,
        reviewedLabel: feedback.reviewedLabel,
        reviewedAt: feedback.reviewedAt,
        createdAt: feedback.createdAt,
      })
      .from(feedback)
      .innerJoin(members, eq(members.id, feedback.authorId))
      .where(and(sql`${feedback.reviewedAt} is not null`, isNull(members.optedOutAt)))
      .orderBy(desc(feedback.reviewedAt))
      .limit(60),
  ]);
  return { history, pending, reviewed };
}

/** Every skill in use, with its author and scope. */
export async function skillsOverview(db: Database) {
  const scoped = alias(members, "scoped");
  return db
    .select({
      id: skills.id,
      name: skills.name,
      kind: skills.kind,
      triggers: skills.triggers,
      rule: skills.rule,
      authorId: skills.authorId,
      author: sql<string | null>`coalesce(${members.displayName}, ${members.username})`,
      channelId: skills.channelId,
      memberId: skills.memberId,
      memberName: sql<string | null>`coalesce(${scoped.displayName}, ${scoped.username})`,
      uses: skills.usageCount,
      lastUsedAt: skills.lastUsedAt,
      expiresAt: skills.expiresAt,
      createdAt: skills.createdAt,
      updatedAt: skills.updatedAt,
      revisions: sql<number>`(select count(*)::int from skill_revisions r where r.skill_id = ${skills.id})`,
    })
    .from(skills)
    .leftJoin(members, eq(members.id, skills.authorId))
    .leftJoin(scoped, eq(scoped.id, skills.memberId))
    .where(and(isNull(skills.deletedAt), sql`(${skills.expiresAt} is null or ${skills.expiresAt} > now())`))
    .orderBy(desc(skills.usageCount), desc(skills.createdAt));
}

/** Closes a skill from the site: its author or an admin. */
export async function closeSkill(db: Database, id: string, by: string, isAdmin: boolean): Promise<"ok" | "not_found" | "forbidden"> {
  const [skill] = await db.select({ authorId: skills.authorId }).from(skills).where(and(eq(skills.id, id), isNull(skills.deletedAt)));
  if (!skill) return "not_found";
  if (skill.authorId !== by && !isAdmin) return "forbidden";
  await db.update(skills).set({ deletedAt: sql`now()`, deletedBy: by }).where(eq(skills.id, id));
  return "ok";
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
  // Admins see DMs too, except those of someone who made theirs private.
  const dm = viewer.isAdmin
    ? sql`(${decisions.guildId} is not null or ${decisions.authorId} = ${viewer.id} or coalesce((${decisions.details}->>'private')::boolean, false) = false)`
    : sql`(${decisions.guildId} is not null or ${decisions.authorId} = ${viewer.id})`;
  const rows = await db
    .select({
      id: decisions.id,
      runId: decisions.runId,
      outcome: decisions.outcome,
      reason: decisions.reason,
      channelName: decisions.channelName,
      guildId: decisions.guildId,
      channelId: decisions.channelId,
      messageId: decisions.messageId,
      isDm: sql<boolean>`${decisions.guildId} is null`,
      authorId: decisions.authorId,
      authorName,
      authorAvatar: author.avatar,
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
          model: sql<string>`(array_agg(coalesce(${aiUsage.servedModel}, ${aiUsage.model}) order by ${aiUsage.createdAt} desc) filter (where ${aiUsage.task} = 'reply'))[1]`,
          provider: sql<string | null>`(array_agg(coalesce(${aiUsage.upstreamProvider}, ${aiUsage.provider}) order by ${aiUsage.createdAt} desc) filter (where ${aiUsage.task} = 'reply'))[1]`,
          version: sql<string | null>`max(${aiUsage.version})`,
          fallbackReason: sql<string | null>`max(${aiUsage.fallbackReason})`,
          inputTokens: sql<number>`sum(${aiUsage.inputTokens})::int`,
          outputTokens: sql<number>`sum(${aiUsage.outputTokens})::int`,
          reasoningTokens: sql<number>`sum(${aiUsage.reasoningTokens})::int`,
          costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
          durationMs: sql<number>`sum(${aiUsage.durationMs})::int`,
          calls: sql<number>`count(*)::int`,
        })
        .from(aiUsage)
        .where(inArray(aiUsage.runId, runIds))
        .groupBy(aiUsage.runId)
    : [];
  const byRun = new Map(usage.map((u) => [u.runId, u]));
  const peopleIds = [...new Set(rows.flatMap((r) => r.details?.people?.map((p) => p.id) ?? []))];
  const pictures = peopleIds.length ? await db.select({ id: members.id, avatar: members.avatar }).from(members).where(inArray(members.id, peopleIds)) : [];
  const avatarOf = new Map(pictures.map((p) => [p.id, p.avatar]));
  return rows.map(({ runId, guildId, channelId, messageId, details, ...r }) => ({
    ...r,
    details: details ? { ...details, people: details.people?.map((p) => ({ ...p, avatar: avatarOf.get(p.id) ?? null })) } : null,
    link: sourceLink(guildId, channelId, messageId),
    usage: runId ? (byRun.get(runId) ?? null) : null,
  }));
}

/**
 * What it learned lately, each with the why and the how: new fragments (from a
 * conversation or a correction), fragments taken off, and drawers it opened.
 */
export async function learnedJournal(db: Database, publicChannels: ReadonlySet<string>, channelNames: ReadonlyMap<string, string>, limit = 50) {
  const subject = alias(members, "subject");
  const reporter = alias(members, "reporter");
  const source = alias(messages, "source");
  const sourceAuthor = alias(members, "source_author");
  const fact = alias(profileFacts, "fact");
  const visibleSubject = and(isNull(subject.optedOutAt), eq(subject.isServer, false));
  const [facts, removals, drawers, labels] = await Promise.all([
    db
      .select({
        id: fact.id,
        memberId: fact.memberId,
        name: sql<string>`coalesce(${subject.displayName}, ${subject.username})`,
        avatar: subject.avatar,
        category: fact.category,
        nature: fact.nature,
        confidence: fact.confidence,
        content: fact.content,
        reporter: sql<string | null>`coalesce(${reporter.displayName}, ${reporter.username})`,
        current: sql<boolean>`${fact.supersededBy} is null and ${fact.deletedAt} is null`,
        ref: fact.ref,
        number: sql<number>`(select count(*)::int from profile_facts o where o.member_id = ${fact.memberId} and o.superseded_by is null and o.deleted_at is null and (o.number, o.created_at) <= (${fact.number}, ${fact.createdAt}))`,
        createdAt: fact.createdAt,
        sourceId: source.id,
        sourceGuildId: source.guildId,
        sourceChannelId: source.channelId,
        sourceAt: source.createdAt,
        sourceContent: source.content,
        sourceAuthor: sql<string | null>`coalesce(${sourceAuthor.displayName}, ${sourceAuthor.username})`,
        correction: sql<{ reason: string; source: string; by: string | null; before: string } | null>`(
          select json_build_object('reason', c.reason, 'source', c.source, 'by', coalesce(b.display_name, b.username), 'before', c.content)
          from profile_facts old join fact_corrections c on c.fact_id = old.id left join members b on b.id = c.by
          where old.superseded_by = ${fact.id} order by c.created_at desc limit 1)`,
      })
      .from(fact)
      .innerJoin(subject, eq(subject.id, fact.memberId))
      .leftJoin(reporter, eq(reporter.id, fact.reportedBy))
      .leftJoin(source, eq(source.id, sql`${fact.sourceMessageIds}[1]`))
      .leftJoin(sourceAuthor, eq(sourceAuthor.id, source.authorId))
      .where(visibleSubject)
      .orderBy(desc(fact.createdAt))
      .limit(limit),
    db
      .select({
        memberId: factCorrections.memberId,
        name: sql<string>`coalesce(${subject.displayName}, ${subject.username})`,
        avatar: subject.avatar,
        content: factCorrections.content,
        reason: factCorrections.reason,
        source: factCorrections.source,
        by: sql<string | null>`(select coalesce(b.display_name, b.username) from members b where b.id = ${factCorrections.by})`,
        createdAt: factCorrections.createdAt,
      })
      .from(factCorrections)
      .innerJoin(subject, eq(subject.id, factCorrections.memberId))
      .where(and(visibleSubject, isNull(factCorrections.newContent)))
      .orderBy(desc(factCorrections.createdAt))
      .limit(20),
    db
      .select({
        key: factCategories.key,
        label: factCategories.label,
        color: factCategories.color,
        reason: factCategories.reason,
        createdAt: factCategories.createdAt,
        memberId: factCategories.memberId,
        owner: sql<string | null>`(select coalesce(m.display_name, m.username) from members m where m.id = ${factCategories.memberId})`,
        count: sql<number>`(select count(*)::int from profile_facts f where f.category = ${factCategories.key} and f.superseded_by is null and f.deleted_at is null)`,
      })
      .from(factCategories)
      .where(eq(factCategories.createdBy, "archive-9"))
      .orderBy(desc(factCategories.createdAt))
      .limit(20),
    listFactCategories(db),
  ]);
  const drawer = new Map(labels.map((c) => [c.key, { label: c.label, color: c.color }]));
  const quote = (f: (typeof facts)[number]) =>
    f.sourceId && f.sourceGuildId && f.sourceChannelId && publicChannels.has(f.sourceChannelId)
      ? {
          messageId: f.sourceId,
          author: f.sourceAuthor,
          channelName: channelNames.get(f.sourceChannelId) ?? null,
          at: f.sourceAt,
          content: f.sourceContent?.slice(0, 200) ?? "",
          link: sourceLink(f.sourceGuildId, f.sourceChannelId, f.sourceId),
        }
      : f.sourceId
        ? { messageId: f.sourceId, author: null, channelName: f.sourceGuildId ? (channelNames.get(f.sourceChannelId ?? "") ?? null) : null, at: f.sourceAt, content: null, link: sourceLink(f.sourceGuildId, f.sourceChannelId, f.sourceId) }
        : null;
  const entries = [
    ...facts.map((f) => ({
      kind: f.correction ? ("correction" as const) : ("fact" as const),
      at: f.createdAt,
      memberId: f.memberId,
      name: f.name,
      avatar: f.avatar,
      factId: f.id,
      number: f.number,
      current: f.current,
      category: { key: f.category, ...(drawer.get(f.category) ?? { label: f.category, color: "#b9b9c3" }) },
      nature: f.nature,
      confidence: f.confidence,
      content: f.content,
      reporter: f.reporter,
      source: quote(f),
      correction: f.correction,
    })),
    ...removals.map((r) => ({ kind: "removal" as const, at: r.createdAt, memberId: r.memberId, name: r.name, avatar: r.avatar, content: r.content, reason: r.reason, via: r.source, by: r.by })),
    ...drawers.map((d) => ({ kind: "drawer" as const, at: d.createdAt, category: { key: d.key, label: d.label, color: d.color }, reason: d.reason, count: d.count })),
  ];
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Every triage decision lately, with what it read and how it reasoned, and the day's counts. */
export async function triageJournal(db: Database, viewer: { id: string; isAdmin: boolean }, limit = 80) {
  const since = new Date(Date.now() - DAY_MS);
  // Admins see DMs too, except those of someone who made theirs private.
  const dm = viewer.isAdmin
    ? sql`(${decisions.guildId} is not null or ${decisions.authorId} = ${viewer.id} or coalesce((${decisions.details}->>'private')::boolean, false) = false)`
    : sql`(${decisions.guildId} is not null or ${decisions.authorId} = ${viewer.id})`;
  const [rows, [counts], ignored] = await Promise.all([
    db
      .select({
        id: decisions.id,
        outcome: decisions.outcome,
        reason: decisions.reason,
        interest: decisions.interest,
        addressed: decisions.addressed,
        channelName: decisions.channelName,
        isDm: sql<boolean>`${decisions.guildId} is null`,
        authorName,
        details: decisions.details,
        createdAt: decisions.createdAt,
      })
      .from(decisions)
      .leftJoin(author, eq(author.id, decisions.authorId))
      .where(and(or(eq(decisions.outcome, "ignored"), sql`${decisions.details}->'triage' is not null`), dm))
      .orderBy(desc(decisions.createdAt))
      .limit(limit),
    db
      .select({
        total: sql<number>`count(*)::int`,
        replied: sql<number>`count(*) filter (where ${decisions.outcome} in ('replied', 'reacted'))::int`,
        silent: sql<number>`count(*) filter (where ${decisions.outcome} = 'silent')::int`,
        ignored: sql<number>`count(*) filter (where ${decisions.outcome} = 'ignored')::int`,
      })
      .from(decisions)
      .where(gte(decisions.createdAt, since)),
    db
      .select({ reason: decisions.reason, n: sql<number>`count(*)::int` })
      .from(decisions)
      .where(and(eq(decisions.outcome, "ignored"), gte(decisions.createdAt, since)))
      .groupBy(decisions.reason)
      .orderBy(desc(sql`2`)),
  ]);
  return {
    counts: counts ?? { total: 0, replied: 0, silent: 0, ignored: 0 },
    ignored,
    rows: rows.map((r) => ({ ...r, details: r.details?.triage ? { triage: r.details.triage } : null })),
  };
}

/**
 * Failed AI calls of the last two days, grouped: same task, model and error within
 * 15 minutes. Each group says what came next (the next call of that task that worked).
 */
export async function errorJournal(db: Database) {
  const since = new Date(Date.now() - 2 * DAY_MS);
  const rows = await db
    .select({
      task: aiUsage.task,
      model: aiUsage.model,
      servedModel: aiUsage.servedModel,
      provider: sql<string>`coalesce(${aiUsage.upstreamProvider}, ${aiUsage.provider})`,
      status: aiUsage.status,
      error: aiUsage.error,
      fallbackReason: aiUsage.fallbackReason,
      detail: aiUsage.detail,
      durationMs: aiUsage.durationMs,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      reasoningTokens: aiUsage.reasoningTokens,
      createdAt: aiUsage.createdAt,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since))
    .orderBy(asc(aiUsage.createdAt));
  type Row = (typeof rows)[number];
  const shortError = (e: string | null) => (e ?? "").replace(/\d{3,}/g, "…").slice(0, 80);
  const groups: { task: string; model: string; error: string; from: Date; to: Date; attempts: Row[]; next: Row | null }[] = [];
  for (const row of rows) {
    if (row.status === "ok") {
      for (const g of groups) if (!g.next && g.task === row.task && row.createdAt > g.to) g.next = row;
      continue;
    }
    const key = shortError(row.error);
    const open = groups.find((g) => g.task === row.task && g.model === row.model && g.error === key && !g.next && row.createdAt.getTime() - g.to.getTime() < 15 * 60_000);
    if (open) {
      open.attempts.push(row);
      open.to = row.createdAt;
    } else groups.push({ task: row.task, model: row.model, error: key, from: row.createdAt, to: row.createdAt, attempts: [row], next: null });
  }
  return groups.reverse().slice(0, 60);
}

/** The system page: what it costs, by day, task, model and person, and its versions. */
export async function systemOverview(db: Database) {
  const month = new Date(Date.now() - 30 * DAY_MS);
  const day = new Date(Date.now() - DAY_MS);
  const [daily, byModel, byPerson, [last24], [speed], core, site] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${aiUsage.createdAt} at time zone 'Europe/Paris'), 'YYYY-MM-DD')`,
        task: aiUsage.task,
        costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${aiUsage.inputTokens})::int`,
        outputTokens: sql<number>`sum(${aiUsage.outputTokens})::int`,
        reasoningTokens: sql<number>`sum(${aiUsage.reasoningTokens})::int`,
        errors: sql<number>`count(*) filter (where ${aiUsage.status} <> 'ok')::int`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, month))
      .groupBy(sql`1`, aiUsage.task)
      .orderBy(sql`1`),
    db
      .select({
        task: aiUsage.task,
        model: aiUsage.model,
        provider: aiUsage.provider,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${aiUsage.inputTokens})::bigint::float`,
        outputTokens: sql<number>`sum(${aiUsage.outputTokens})::bigint::float`,
        costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
        medianMs: sql<number | null>`percentile_cont(0.5) within group (order by ${aiUsage.durationMs}) filter (where ${aiUsage.status} = 'ok')`,
        errors: sql<number>`count(*) filter (where ${aiUsage.status} <> 'ok')::int`,
        fallbacks: sql<number>`count(*) filter (where ${aiUsage.fallbackReason} is not null)::int`,
        served: sql<string[] | null>`array_remove(array_agg(distinct ${aiUsage.servedModel}), null)`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, month))
      .groupBy(aiUsage.task, aiUsage.model, aiUsage.provider)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        id: author.id,
        name: authorName,
        avatar: author.avatar,
        costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
        replies: sql<number>`count(distinct ${decisions.id})::int`,
      })
      .from(decisions)
      .innerJoin(aiUsage, eq(aiUsage.runId, decisions.runId))
      .innerJoin(author, eq(author.id, decisions.authorId))
      .where(and(gte(decisions.createdAt, new Date(Date.now() - 14 * DAY_MS)), isNull(author.optedOutAt)))
      .groupBy(author.id, author.displayName, author.username, author.avatar)
      .orderBy(desc(sql`4`))
      .limit(8),
    db
      .select({
        costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
        replyCostUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}) filter (where ${aiUsage.task} = 'reply'), 0)::float`,
        calls: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${aiUsage.status} <> 'ok')::int`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, day)),
    db
      .select({
        median: sql<number | null>`percentile_cont(0.5) within group (order by ${aiUsage.durationMs})`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${aiUsage.durationMs})`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.task, "reply"), eq(aiUsage.status, "ok"), gte(aiUsage.createdAt, day))),
    latestReleases(db, "core", 2),
    latestReleases(db, "site", 2),
  ]);
  return {
    daily,
    byModel,
    byPerson,
    last24: last24 ?? { costUsd: 0, replyCostUsd: 0, calls: 0, errors: 0 },
    speed: speed ?? { median: null, p95: null },
    releases: { core, site },
  };
}

/** Members the owner can name admin, with who already is. */
export async function accessList(db: Database) {
  return db
    .select({ id: members.id, name: memberName, username: members.username, avatar: members.avatar, isAdmin: sql<boolean>`exists (select 1 from site_admins a where a.member_id = ${members.id})` })
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
  return (await saveSelfState(db, old.state, "rollback", by)).version;
}

/** Display names for the tags found in texts, so `<@123>` reads as `@Tom`. */
export async function namesFor(db: Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: members.id, name: memberName }).from(members).where(inArray(members.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
