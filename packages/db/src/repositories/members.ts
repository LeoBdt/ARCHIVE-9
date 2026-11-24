import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { members } from "../schema.ts";

export interface MemberInput {
  id: string;
  username: string;
  displayName: string | null;
  isBot: boolean;
  isKnownAiBot: boolean;
  /** Discord avatar hash; absent leaves the stored one. */
  avatar?: string | null;
}

/**
 * Creates or refreshes a member. A new display name is appended to the history,
 * so past nicknames stay attached to the same ID.
 */
export async function upsertMember(db: Database, input: MemberInput): Promise<void> {
  const name = input.displayName ?? input.username;
  const entry = JSON.stringify([{ name, seenAt: new Date().toISOString() }]);
  await db
    .insert(members)
    .values({ ...input, nameHistory: sql`${entry}::jsonb` })
    .onConflictDoUpdate({
      target: members.id,
      set: {
        username: input.username,
        displayName: input.displayName,
        isBot: input.isBot,
        avatar: input.avatar === undefined ? members.avatar : input.avatar,
        // Once recognised as an AI agent, a bot stays one.
        isKnownAiBot: sql`${members.isKnownAiBot} or ${input.isKnownAiBot}`,
        lastSeenAt: sql`now()`,
        nameHistory: sql`case
          when coalesce(${members.displayName}, ${members.username}) is distinct from ${name}
          then ${members.nameHistory} || ${entry}::jsonb
          else ${members.nameHistory} end`,
      },
    });
}

/** Adds a member seen only in history, leaving an existing row untouched. */
export async function ensureMember(db: Database, input: MemberInput): Promise<void> {
  const name = input.displayName ?? input.username;
  await db
    .insert(members)
    .values({ ...input, nameHistory: [{ name, seenAt: new Date().toISOString() }] })
    .onConflictDoNothing();
}

/** Creates or renames the row that holds the server's own profile. */
export async function ensureServerProfile(db: Database, guildId: string, name: string): Promise<void> {
  await db
    .insert(members)
    .values({ id: guildId, username: name, isServer: true, nameHistory: [{ name, seenAt: new Date().toISOString() }] })
    .onConflictDoUpdate({ target: members.id, set: { username: name, isServer: true } });
}

export interface DirectoryMember {
  id: string;
  name: string;
  isBot: boolean;
  /** Current and former names, to recognise people mentioned without a tag. */
  names: string[];
}

/** Every member and known bot ARCHIVE-9 may talk about. Opted-out members and the server row are left out. */
export async function memberDirectory(db: Database): Promise<DirectoryMember[]> {
  const rows = await db
    .select()
    .from(members)
    .where(and(isNull(members.optedOutAt), eq(members.isServer, false)));
  return rows
    .filter((row) => !row.isBot || row.isKnownAiBot)
    .map((row) => ({
      id: row.id,
      name: row.displayName ?? row.username,
      isBot: row.isBot,
      names: [...new Set([row.displayName, row.username, ...row.nameHistory.map((entry) => entry.name)].filter((n): n is string => Boolean(n)))],
    }));
}

export async function optedOutIds(db: Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(sql`${inArray(members.id, ids)} and ${members.optedOutAt} is not null`);
  return new Set(rows.map((row) => row.id));
}

export async function getMember(db: Database, id: string) {
  const [row] = await db.select().from(members).where(eq(members.id, id));
  return row;
}

/** Marks who is on the server right now, creating rows for members who never wrote. */
export async function syncGuildMembers(db: Database, current: MemberInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const member of current) {
      const name = member.displayName ?? member.username;
      await tx
        .insert(members)
        .values({ ...member, inGuild: true, nameHistory: [{ name, seenAt: new Date().toISOString() }] })
        .onConflictDoUpdate({
          target: members.id,
          set: { username: member.username, displayName: member.displayName, inGuild: true, avatar: member.avatar ?? null },
        });
    }
    const ids = current.map((m) => m.id);
    await tx
      .update(members)
      .set({ inGuild: false })
      .where(ids.length ? and(eq(members.isServer, false), notInArray(members.id, ids)) : eq(members.isServer, false));
  });
}

export async function setInGuild(db: Database, input: MemberInput, inGuild: boolean): Promise<void> {
  if (inGuild) await upsertMember(db, input);
  await db.update(members).set({ inGuild }).where(eq(members.id, input.id));
}
