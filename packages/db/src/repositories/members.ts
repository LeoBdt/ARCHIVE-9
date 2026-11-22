import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { members } from "../schema.ts";

export interface MemberInput {
  id: string;
  username: string;
  displayName: string | null;
  isBot: boolean;
  isKnownAiBot: boolean;
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
        isKnownAiBot: input.isKnownAiBot,
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
