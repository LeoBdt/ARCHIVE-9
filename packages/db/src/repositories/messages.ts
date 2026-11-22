import type { MessageReactions, TranscriptMessage } from "@archive-9/core";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, max, min, ne, notInArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../client.ts";
import { members, messages } from "../schema.ts";

export interface MessageInput {
  id: string;
  guildId: string | null;
  channelId: string;
  authorId: string;
  content: string;
  replyToId: string | null;
  mentionedIds: string[];
  createdAt: Date;
  reactions?: MessageReactions;
}

/** A stored message, ready for `formatTranscript`. */
export interface StoredMessage extends TranscriptMessage {
  /** Null for direct messages. */
  guildId: string | null;
  channelId: string;
  mentionedIds: string[];
  reactions: MessageReactions;
}

export async function saveMessage(db: Database, input: MessageInput): Promise<void> {
  await db.insert(messages).values(input).onConflictDoNothing();
}

/** Inserts messages that aren't stored yet and returns the IDs actually inserted. */
export async function insertMessages(db: Database, inputs: MessageInput[]): Promise<string[]> {
  const inserted: string[] = [];
  for (let start = 0; start < inputs.length; start += 500) {
    const rows = await db
      .insert(messages)
      .values(inputs.slice(start, start + 500))
      .onConflictDoNothing()
      .returning({ id: messages.id });
    inserted.push(...rows.map((row) => row.id));
  }
  return inserted;
}

export async function existingMessageIds(db: Database, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let start = 0; start < ids.length; start += 1_000) {
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(inArray(messages.id, ids.slice(start, start + 1_000)));
    for (const row of rows) found.add(row.id);
  }
  return found;
}

export async function updateMessageContent(db: Database, id: string, content: string, editedAt: Date): Promise<void> {
  await db.update(messages).set({ content, editedAt }).where(eq(messages.id, id));
}

export async function setMessageReactions(db: Database, id: string, reactions: MessageReactions): Promise<void> {
  await db.update(messages).set({ reactions }).where(eq(messages.id, id));
}

export async function deleteMessages(db: Database, ids: string[]): Promise<void> {
  if (ids.length > 0) await db.delete(messages).where(inArray(messages.id, ids));
}

const replied = alias(messages, "replied");
const repliedAuthor = alias(members, "replied_author");

async function selectStored(
  db: Database,
  selfId: string,
  where: SQL | undefined,
  order: "asc" | "desc",
  limit: number,
): Promise<StoredMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      guildId: messages.guildId,
      channelId: messages.channelId,
      authorId: messages.authorId,
      username: members.username,
      displayName: members.displayName,
      isBot: members.isBot,
      content: messages.content,
      replyToId: messages.replyToId,
      replyToAuthorId: replied.authorId,
      replyToUsername: repliedAuthor.username,
      replyToDisplayName: repliedAuthor.displayName,
      mentionedIds: messages.mentionedIds,
      reactions: messages.reactions,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(members, eq(members.id, messages.authorId))
    .leftJoin(replied, eq(replied.id, messages.replyToId))
    .leftJoin(repliedAuthor, eq(repliedAuthor.id, replied.authorId))
    .where(where)
    .orderBy(order === "asc" ? asc(messages.createdAt) : desc(messages.createdAt))
    .limit(limit);
  const result = rows.map((row) => ({
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName: row.displayName ?? row.username,
    authorIsBot: row.isBot,
    isSelf: row.authorId === selfId,
    content: row.content,
    replyToId: row.replyToId,
    replyToAuthorName: row.replyToDisplayName ?? row.replyToUsername,
    replyToIsSelf: row.replyToAuthorId === selfId,
    mentionedIds: row.mentionedIds,
    reactions: row.reactions,
    createdAt: row.createdAt,
  }));
  return order === "desc" ? result.reverse() : result;
}

/** Last `limit` messages of a channel, oldest first. */
export async function recentMessages(db: Database, channelId: string, selfId: string, limit: number): Promise<StoredMessage[]> {
  return selectStored(db, selfId, eq(messages.channelId, channelId), "desc", limit);
}

/** Oldest messages not analysed yet, written before `before`. */
export async function pendingMessages(db: Database, selfId: string, before: Date, limit: number): Promise<StoredMessage[]> {
  return selectStored(db, selfId, and(isNull(messages.analysedAt), lt(messages.createdAt, before)), "asc", limit);
}

/** Already analysed messages of a channel between `since` and `before`, to show how a conversation started. */
export async function contextBefore(
  db: Database,
  selfId: string,
  channelId: string,
  window: { since: Date; before: Date },
  limit: number,
): Promise<StoredMessage[]> {
  return selectStored(
    db,
    selfId,
    and(
      eq(messages.channelId, channelId),
      isNotNull(messages.analysedAt),
      gte(messages.createdAt, window.since),
      lt(messages.createdAt, window.before),
    ),
    "desc",
    limit,
  );
}

/**
 * What a member said recently outside `excludeIds`, and ARCHIVE-9's replies to them, oldest
 * first. Gives the bot a short memory across channels and DMs before the analysis runs.
 */
export async function recentWithMember(
  db: Database,
  selfId: string,
  memberId: string,
  options: { since: Date; excludeIds: string[]; limit: number },
): Promise<StoredMessage[]> {
  return selectStored(
    db,
    selfId,
    and(
      gte(messages.createdAt, options.since),
      options.excludeIds.length > 0 ? notInArray(messages.id, options.excludeIds) : undefined,
      or(eq(messages.authorId, memberId), and(eq(messages.authorId, selfId), eq(replied.authorId, memberId))),
    ),
    "desc",
    options.limit,
  );
}

/** Messages written since `since`, oldest first. */
export async function messagesSince(db: Database, selfId: string, since: Date, limit: number): Promise<StoredMessage[]> {
  return selectStored(db, selfId, gte(messages.createdAt, since), "asc", limit);
}

/** When the oldest pending message was written, and the largest pending count for one member. */
export async function pendingStats(db: Database, selfId: string): Promise<{ oldestAt: Date | null; maxPerMember: number }> {
  const [[oldest], [busiest]] = await Promise.all([
    db.select({ at: min(messages.createdAt) }).from(messages).where(isNull(messages.analysedAt)),
    db
      .select({ n: count() })
      .from(messages)
      .where(and(isNull(messages.analysedAt), ne(messages.authorId, selfId)))
      .groupBy(messages.authorId)
      .orderBy(desc(count()))
      .limit(1),
  ]);
  return { oldestAt: oldest?.at ?? null, maxPerMember: busiest?.n ?? 0 };
}

export async function markAnalysed(db: Database, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += 1_000) {
    await db
      .update(messages)
      .set({ analysedAt: new Date() })
      .where(inArray(messages.id, ids.slice(start, start + 1_000)));
  }
}

/** Deletes raw messages older than `before`. Profiles are kept. */
export async function purgeMessages(db: Database, before: Date): Promise<number> {
  const rows = await db.delete(messages).where(lt(messages.createdAt, before)).returning({ id: messages.id });
  return rows.length;
}

export async function lastMessageAt(db: Database, channelId: string, authorId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(messages.createdAt) })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.authorId, authorId)));
  return row?.at ?? null;
}
