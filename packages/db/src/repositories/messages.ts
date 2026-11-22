import type { MessageReactions, TranscriptMessage } from "@archive-9/core";
import { and, desc, eq, inArray, max } from "drizzle-orm";
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
}

export async function saveMessage(db: Database, input: MessageInput): Promise<void> {
  await db.insert(messages).values(input).onConflictDoNothing();
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

/** Last `limit` messages of a channel, oldest first, ready for `formatTranscript`. */
export async function recentMessages(
  db: Database,
  channelId: string,
  selfId: string,
  limit: number,
): Promise<TranscriptMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      authorId: messages.authorId,
      username: members.username,
      displayName: members.displayName,
      isBot: members.isBot,
      content: messages.content,
      replyToId: messages.replyToId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(members, eq(members.id, messages.authorId))
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse().map((row) => ({
    id: row.id,
    authorId: row.authorId,
    authorName: row.displayName ?? row.username,
    authorIsBot: row.isBot,
    isSelf: row.authorId === selfId,
    content: row.content,
    replyToId: row.replyToId,
    createdAt: row.createdAt,
  }));
}

export async function lastMessageAt(db: Database, channelId: string, authorId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(messages.createdAt) })
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.authorId, authorId)));
  return row?.at ?? null;
}
