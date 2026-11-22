import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { actionsLog, members, profileFacts, profileSummaries, relationshipEvents, relationships, selfStateVersions, siteAdmins, skills } from "../schema.ts";

export interface SiteViewer {
  id: string;
  name: string;
  inGuild: boolean;
  optedOut: boolean;
  isAdmin: boolean;
}

/** The member behind a site session, or undefined when the bot has never seen them. */
export async function siteViewer(db: Database, discordId: string): Promise<SiteViewer | undefined> {
  const [row] = await db
    .select({
      id: members.id,
      name: sql<string>`coalesce(${members.displayName}, ${members.username})`,
      inGuild: members.inGuild,
      optedOutAt: members.optedOutAt,
      admin: siteAdmins.memberId,
    })
    .from(members)
    .leftJoin(siteAdmins, eq(siteAdmins.memberId, members.id))
    .where(and(eq(members.id, discordId), eq(members.isServer, false)));
  if (!row) return undefined;
  return { id: row.id, name: row.name, inGuild: row.inGuild, optedOut: row.optedOutAt !== null, isAdmin: row.admin !== null };
}

export type FeedKind = "learned" | "action" | "skill" | "relation" | "memory";

export interface FeedEvent {
  at: Date;
  kind: FeedKind;
  text: string;
}

const visible = and(isNull(members.optedOutAt), eq(members.isServer, false));
const memberName = sql<string>`coalesce(${members.displayName}, ${members.username})`;
const currentFact = and(isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt));

function actionText(tool: string, params: Record<string, unknown>): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  switch (tool) {
    case "createChannel":
      return `J'ai créé le salon #${text(params.name)}.`;
    case "renameChannel":
      return `J'ai renommé un salon en #${text(params.name)}.`;
    case "renameMember":
      return "J'ai changé un pseudo, sur demande.";
    case "setRole":
      return `J'ai ${params.give ? "donné" : "retiré"} le rôle ${text(params.role)}.`;
    case "pinMessage":
      return "J'ai épinglé un message.";
    case "createThread":
      return `J'ai ouvert le fil « ${text(params.name)} ».`;
    case "createPoll":
      return `J'ai lancé un sondage : ${text(params.question)}`;
    default:
      return "J'ai agi sur le serveur.";
  }
}

/** Everything the home page shows, in one call. */
export async function homeOverview(db: Database, limits = { members: 6, skills: 3, feed: 12 }) {
  const [counts] = await db.execute<{ messages: number; facts: number; dossiers: number; skills: number }>(sql`
    select
      (select count(*)::int from messages) as messages,
      (select count(*)::int from profile_facts f join members m on m.id = f.member_id
        where f.superseded_by is null and f.deleted_at is null and not m.is_server) as facts,
      (select count(*)::int from profile_summaries s join members m on m.id = s.member_id where not m.is_server) as dossiers,
      (select count(*)::int from skills where deleted_at is null and (expires_at is null or expires_at > now())) as skills`);

  const closest = await db
    .select({
      id: members.id,
      name: memberName,
      isBot: members.isBot,
      tagline: profileSummaries.tagline,
      affinity: relationships.affinity,
      messages: sql<number>`(select count(*)::int from messages where author_id = ${members.id})`,
      facts: sql<number>`(select count(*)::int from profile_facts f where f.member_id = ${members.id} and f.superseded_by is null and f.deleted_at is null)`,
    })
    .from(relationships)
    .innerJoin(members, eq(members.id, relationships.memberId))
    .leftJoin(profileSummaries, eq(profileSummaries.memberId, members.id))
    .where(visible)
    .orderBy(desc(relationships.interactionCount), desc(relationships.lastInteractionAt))
    .limit(limits.members);

  const topSkills = await db
    .select({
      name: skills.name,
      kind: skills.kind,
      rule: skills.rule,
      author: sql<string | null>`coalesce(${members.displayName}, ${members.username})`,
      uses: skills.usageCount,
      expiresAt: skills.expiresAt,
    })
    .from(skills)
    .leftJoin(members, eq(members.id, skills.authorId))
    .where(and(isNull(skills.deletedAt), sql`(${skills.expiresAt} is null or ${skills.expiresAt} > now())`))
    .orderBy(desc(skills.usageCount), desc(skills.createdAt))
    .limit(limits.skills);

  const n = limits.feed;
  const [facts, actions, taught, relations, memories] = await Promise.all([
    db
      .select({ at: profileFacts.createdAt, name: memberName, content: profileFacts.content })
      .from(profileFacts)
      .innerJoin(members, eq(members.id, profileFacts.memberId))
      .where(and(currentFact, visible))
      .orderBy(desc(profileFacts.createdAt))
      .limit(n),
    db
      .select({ at: actionsLog.createdAt, tool: actionsLog.tool, params: actionsLog.params })
      .from(actionsLog)
      .where(eq(actionsLog.status, "done"))
      .orderBy(desc(actionsLog.createdAt))
      .limit(n),
    db
      .select({ at: skills.createdAt, name: skills.name, author: memberName })
      .from(skills)
      .innerJoin(members, eq(members.id, skills.authorId))
      .where(visible)
      .orderBy(desc(skills.createdAt))
      .limit(n),
    db
      .select({ at: relationshipEvents.createdAt, name: memberName, delta: relationshipEvents.affinityDelta, reason: relationshipEvents.reason })
      .from(relationshipEvents)
      .innerJoin(members, eq(members.id, relationshipEvents.memberId))
      .where(visible)
      .orderBy(desc(relationshipEvents.createdAt))
      .limit(n),
    db
      .select({ at: selfStateVersions.createdAt, state: selfStateVersions.state })
      .from(selfStateVersions)
      .where(eq(selfStateVersions.source, "reflection"))
      .orderBy(desc(selfStateVersions.createdAt))
      .limit(3),
  ]);

  const feed: FeedEvent[] = [
    ...facts.map((f) => ({ at: f.at, kind: "learned" as const, text: `${f.name} : ${f.content}` })),
    ...actions.map((a) => ({ at: a.at, kind: "action" as const, text: actionText(a.tool, a.params) })),
    ...taught.map((s) => ({ at: s.at, kind: "skill" as const, text: `${s.author} m'a appris « ${s.name} ».` })),
    ...relations.map((r) => ({
      at: r.at,
      kind: "relation" as const,
      text: `${r.name} · ${r.delta > 0 ? `+${String(r.delta)}` : String(r.delta)} · ${r.reason}`,
    })),
    ...memories.map((m) => ({ at: m.at, kind: "memory" as const, text: `J'ai repensé à ma journée. Humeur : ${m.state.mood}.` })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, n);

  return { counts: counts ?? { messages: 0, facts: 0, dossiers: 0, skills: 0 }, closest, skills: topSkills, feed };
}

export async function grantSiteAdmin(db: Database, memberId: string, by: string): Promise<void> {
  await db.insert(siteAdmins).values({ memberId, grantedBy: by }).onConflictDoNothing();
}
