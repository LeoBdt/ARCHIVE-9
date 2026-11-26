import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { messageImages, messages } from "../schema.ts";

export interface ImageInput {
  id: string;
  messageId: string;
  url: string;
  kind: "image" | "gif" | "embed";
  name: string | null;
}

export async function saveImages(db: Database, images: ImageInput[]): Promise<void> {
  if (images.length > 0) await db.insert(messageImages).values(images).onConflictDoNothing();
}

export interface PendingImage {
  id: string;
  messageId: string;
  url: string;
  kind: string;
  name: string | null;
  content: string;
}

/** Images not looked at yet, among these messages or a channel's recent ones. */
export async function pendingImages(db: Database, where: { messageIds?: string[]; channelId?: string; since?: Date }, limit: number): Promise<PendingImage[]> {
  if (where.messageIds?.length === 0) return [];
  return db
    .select({ id: messageImages.id, messageId: messageImages.messageId, url: messageImages.url, kind: messageImages.kind, name: messageImages.name, content: messages.content })
    .from(messageImages)
    .innerJoin(messages, eq(messages.id, messageImages.messageId))
    .where(
      and(
        isNull(messageImages.describedAt),
        where.messageIds ? inArray(messageImages.messageId, where.messageIds) : undefined,
        where.channelId ? eq(messages.channelId, where.channelId) : undefined,
        where.since ? gte(messages.createdAt, where.since) : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

/** What it understood of an image, or why it couldn't look (never retried). */
export async function saveImageDescription(db: Database, id: string, result: { description: string | null; model: string | null; error: string | null }): Promise<void> {
  await db
    .update(messageImages)
    .set({ ...result, describedAt: sql`now()` })
    .where(eq(messageImages.id, id));
}

/** Descriptions by message, for transcripts built outside the database (DMs read from Discord). */
export async function imagesByMessage(db: Database, messageIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({ messageId: messageImages.messageId, description: messageImages.description })
    .from(messageImages)
    .where(and(inArray(messageImages.messageId, messageIds), sql`${messageImages.description} is not null`))
    .orderBy(asc(messageImages.id));
  for (const row of rows) result.set(row.messageId, [...(result.get(row.messageId) ?? []), row.description ?? ""]);
  return result;
}
