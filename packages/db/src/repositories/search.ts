import type { SearchKind, SearchQuery } from "@archive-9/core";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../client.ts";

export interface SearchViewer {
  id: string;
  isAdmin: boolean;
}

export interface SearchOptions {
  /** Channels everyone on the server can read: messages elsewhere stay hidden. */
  publicChannelIds: string[];
  limit?: number;
}

export interface FragmentHit {
  id: string;
  ref: string;
  rank: number;
  memberId: string;
  memberName: string;
  avatar: string | null;
  category: string;
  categoryLabel: string | null;
  nature: string;
  confidence: number;
  content: string;
  createdAt: string;
  score: number;
}

export interface MessageHit {
  id: string;
  channelId: string;
  guildId: string | null;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
  images: string[] | null;
  createdAt: string;
  score: number;
}

export interface DossierHit {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  tagline: string | null;
  facts: number;
}

export interface SkillHit {
  id: string;
  name: string;
  kind: string;
  rule: string;
  authorName: string | null;
  createdAt: string;
}

export interface JournalHit {
  id: string;
  messageId: string;
  channelName: string | null;
  authorName: string;
  content: string | null;
  sent: string | null;
  createdAt: string;
}

export interface RelationHit {
  memberId: string;
  memberName: string;
  affinityDelta: number;
  trustDelta: number;
  reason: string;
  createdAt: string;
}

export interface SearchResults {
  fragments: FragmentHit[];
  messages: MessageHit[];
  dossiers: DossierHit[];
  skills: SkillHit[];
  journal: JournalHit[];
  relations: RelationHit[];
  /** People the `@` filters matched. */
  people: { id: string; name: string }[];
}

const norm = (col: SQL) => sql`a9_unaccent(lower(${col}))`;

/** Words (French stemming, accents ignored) or close spellings, plus exact phrases. */
function matches(col: SQL, q: SearchQuery, ftsCol?: SQL): SQL | null {
  const parts: SQL[] = [];
  if (q.text) {
    parts.push(sql`(to_tsvector('french', a9_unaccent(${ftsCol ?? col})) @@ websearch_to_tsquery('french', a9_unaccent(${q.text})) or a9_unaccent(lower(${q.text})) <% ${norm(col)})`);
  }
  for (const phrase of q.phrases) parts.push(sql`${norm(col)} like '%' || a9_unaccent(lower(${phrase})) || '%'`);
  return parts.length ? sql.join(parts, sql` and `) : null;
}

function score(col: SQL, q: SearchQuery): SQL {
  if (!q.text) return sql`0`;
  return sql`(ts_rank(to_tsvector('french', a9_unaccent(${col})), websearch_to_tsquery('french', a9_unaccent(${q.text}))) + word_similarity(a9_unaccent(lower(${q.text})), ${norm(col)}))`;
}

const where = (parts: (SQL | null | undefined)[]) => {
  const kept = parts.filter((p): p is SQL => Boolean(p));
  return kept.length ? sql`where ${sql.join(kept, sql` and `)}` : sql``;
};

const inList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** Members whose current or former name, or username, matches each `@` filter. */
async function resolvePeople(db: Database, names: string[]): Promise<{ id: string; name: string }[]> {
  const found = new Map<string, string>();
  for (const name of names.slice(0, 5)) {
    const rows = await db.execute<{ id: string; name: string }>(sql`
      select id, coalesce(display_name, username) as name from members
      where is_server = false and (
        ${norm(sql`coalesce(display_name, '')`)} like a9_unaccent(lower(${name})) || '%'
        or ${norm(sql`username`)} like a9_unaccent(lower(${name})) || '%'
        or exists (select 1 from jsonb_array_elements(name_history) h where a9_unaccent(lower(h->>'name')) like a9_unaccent(lower(${name})) || '%')
        or id = ${name})
      order by last_seen_at desc limit 5`);
    for (const r of rows) found.set(r.id, r.name);
  }
  return [...found].map(([id, name]) => ({ id, name }));
}

const wants = (q: SearchQuery, kind: SearchKind) => q.kind === null || q.kind === kind;

/**
 * The search engine behind the site's Archives page and ARCHIVE-9's own search tool. Every
 * kind is searched at once; filters that don't apply to a kind leave it empty.
 */
export async function searchArchives(db: Database, q: SearchQuery, viewer: SearchViewer, options: SearchOptions): Promise<SearchResults> {
  const limit = Math.min(options.limit ?? 20, 50);
  const people = q.people.length ? await resolvePeople(db, q.people) : [];
  const personIds = people.map((p) => p.id);
  const noPerson = q.people.length > 0 && personIds.length === 0;
  const empty: SearchResults = { fragments: [], messages: [], dossiers: [], skills: [], journal: [], relations: [], people };
  if (noPerson) return empty;
  const after = q.after ? sql`>= ${q.after.toISOString()}::timestamptz` : null;
  const before = q.before ? sql`< ${new Date(q.before.getTime() + 24 * 60 * 60_000).toISOString()}::timestamptz` : null;
  const hasWords = Boolean(q.text || q.phrases.length);
  const onlyFragments = q.refs.length > 0 || q.numbers.length > 0 || Boolean(q.drawer) || Boolean(q.nature);

  const fragmentText = matches(sql`f.content`, q);
  const fragments =
    wants(q, "fragments") && (hasWords || onlyFragments || personIds.length)
      ? await db.execute<FragmentHit & Record<string, unknown>>(sql`
        select * from (
          select f.id, f.ref,
            (select count(*)::int from profile_facts o where o.member_id = f.member_id and o.superseded_by is null and o.deleted_at is null and (o.number, o.created_at) <= (f.number, f.created_at)) as rank,
            f.member_id as "memberId", coalesce(m.display_name, m.username) as "memberName", m.avatar,
            f.category, c.label as "categoryLabel", f.nature, f.confidence, f.content, f.created_at as "createdAt",
            ${score(sql`f.content`, q)}::float8 as score
          from profile_facts f
          join members m on m.id = f.member_id and m.opted_out_at is null
          left join fact_categories c on c.key = f.category
          ${where([
            sql`f.superseded_by is null and f.deleted_at is null`,
            fragmentText,
            personIds.length ? sql`f.member_id in (${inList(personIds)})` : null,
            q.refs.length ? sql`f.ref in (${inList(q.refs)})` : null,
            q.drawer ? sql`(${norm(sql`c.label`)} like a9_unaccent(lower(${q.drawer})) || '%' or f.category = ${q.drawer})` : null,
            q.nature ? sql`f.nature = ${q.nature}` : null,
            after ? sql`f.created_at ${after}` : null,
            before ? sql`f.created_at ${before}` : null,
          ])}
        ) hits
        ${q.numbers.length ? sql`where rank in (${sql.join(q.numbers.map((n) => sql`${n}`), sql`, `)})` : sql``}
        order by score desc, "createdAt" desc
        limit ${limit}`)
      : [];

  // Public channels for everyone; DMs only for their member, or for admins.
  const publicOnes = options.publicChannelIds.length ? sql`m.channel_id in (${inList(options.publicChannelIds)})` : sql`false`;
  const visible = viewer.isAdmin
    ? sql`(${publicOnes} or m.guild_id is null)`
    : sql`(${publicOnes} or (m.guild_id is null and exists (select 1 from messages o where o.channel_id = m.channel_id and o.author_id = ${viewer.id})))`;
  const messageText = matches(sql`(m.content || ' ' || coalesce((select string_agg(i.description, ' ') from message_images i where i.message_id = m.id), ''))`, q, sql`m.content`);
  const messages =
    wants(q, "messages") && !onlyFragments && (hasWords || personIds.length)
      ? await db.execute<MessageHit & Record<string, unknown>>(sql`
        select m.id, m.channel_id as "channelId", m.guild_id as "guildId", m.author_id as "authorId",
          coalesce(a.display_name, a.username) as "authorName", a.avatar, m.content,
          (select array_agg(i.description) from message_images i where i.message_id = m.id and i.description is not null) as images,
          m.created_at as "createdAt", ${score(sql`m.content`, q)}::float8 as score
        from messages m
        join members a on a.id = m.author_id and a.opted_out_at is null
        ${where([
          visible,
          messageText,
          personIds.length ? sql`m.author_id in (${inList(personIds)})` : null,
          after ? sql`m.created_at ${after}` : null,
          before ? sql`m.created_at ${before}` : null,
        ])}
        order by score desc, m.created_at desc
        limit ${limit}`)
      : [];

  const dossierText = q.text ? sql`(${norm(sql`coalesce(m.display_name, m.username)`)} like '%' || a9_unaccent(lower(${q.text})) || '%' or ${norm(sql`m.username`)} like '%' || a9_unaccent(lower(${q.text})) || '%' or ${matches(sql`coalesce(s.summary, '')`, q) ?? sql`false`})` : null;
  const dossiers =
    wants(q, "dossiers") && !onlyFragments && (q.text || personIds.length)
      ? await db.execute<DossierHit & Record<string, unknown>>(sql`
        select m.id, coalesce(m.display_name, m.username) as name, m.username, m.avatar, s.tagline,
          (select count(*)::int from profile_facts f where f.member_id = m.id and f.superseded_by is null and f.deleted_at is null) as facts
        from members m left join profile_summaries s on s.member_id = m.id
        ${where([sql`m.opted_out_at is null and m.is_server = false`, dossierText, personIds.length ? sql`m.id in (${inList(personIds)})` : null])}
        order by facts desc limit ${Math.min(limit, 12)}`)
      : [];

  const skills =
    wants(q, "skills") && !onlyFragments && hasWords
      ? await db.execute<SkillHit & Record<string, unknown>>(sql`
        select k.id, k.name, k.kind, k.rule, coalesce(a.display_name, a.username) as "authorName", k.created_at as "createdAt"
        from skills k left join members a on a.id = k.author_id
        ${where([sql`k.deleted_at is null`, matches(sql`(k.name || ' ' || k.rule)`, q), personIds.length ? sql`k.author_id in (${inList(personIds)})` : null])}
        order by k.created_at desc limit ${Math.min(limit, 12)}`)
      : [];

  const dm = viewer.isAdmin
    ? sql`(d.guild_id is not null or d.author_id = ${viewer.id} or coalesce((d.details->>'private')::boolean, false) = false)`
    : sql`(d.guild_id is not null or d.author_id = ${viewer.id})`;
  const journal =
    wants(q, "journal") && !onlyFragments && hasWords
      ? await db.execute<JournalHit & Record<string, unknown>>(sql`
        select d.id, d.message_id as "messageId", d.channel_name as "channelName", coalesce(a.display_name, a.username) as "authorName",
          d.content, d.details->>'sent' as sent, d.created_at as "createdAt"
        from decisions d join members a on a.id = d.author_id
        ${where([sql`d.outcome = 'replied'`, dm, matches(sql`(coalesce(d.content, '') || ' ' || coalesce(d.details->>'sent', ''))`, q), personIds.length ? sql`d.author_id in (${inList(personIds)})` : null])}
        order by d.created_at desc limit ${Math.min(limit, 12)}`)
      : [];

  const relations =
    wants(q, "relations") && !onlyFragments && (hasWords || personIds.length)
      ? await db.execute<RelationHit & Record<string, unknown>>(sql`
        select e.member_id as "memberId", coalesce(m.display_name, m.username) as "memberName",
          e.affinity_delta::float8 as "affinityDelta", e.trust_delta::float8 as "trustDelta", e.reason, e.created_at as "createdAt"
        from relationship_events e join members m on m.id = e.member_id
        ${where([matches(sql`e.reason`, q), personIds.length ? sql`e.member_id in (${inList(personIds)})` : null, after ? sql`e.created_at ${after}` : null, before ? sql`e.created_at ${before}` : null])}
        order by e.created_at desc limit ${Math.min(limit, 12)}`)
      : [];

  return { fragments: [...fragments], messages: [...messages], dossiers: [...dossiers], skills: [...skills], journal: [...journal], relations: [...relations], people };
}
