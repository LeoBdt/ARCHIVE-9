export interface ChannelMessage {
  channelId: string;
  createdAt: Date;
}

export const CONVERSATION_GAP_MS = 15 * 60_000;

/** Splits messages into conversations: same channel, no silence longer than `maxGapMs`. Oldest first. */
export function groupConversations<T extends ChannelMessage>(messages: readonly T[], maxGapMs = CONVERSATION_GAP_MS): T[][] {
  const byChannel = new Map<string, T[]>();
  for (const message of [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const list = byChannel.get(message.channelId) ?? [];
    list.push(message);
    byChannel.set(message.channelId, list);
  }

  const conversations: T[][] = [];
  for (const list of byChannel.values()) {
    let current: T[] = [];
    for (const message of list) {
      const last = current.at(-1);
      if (last && message.createdAt.getTime() - last.createdAt.getTime() > maxGapMs) {
        conversations.push(current);
        current = [];
      }
      current.push(message);
    }
    if (current.length > 0) conversations.push(current);
  }
  return conversations.sort((a, b) => (a[0]?.createdAt.getTime() ?? 0) - (b[0]?.createdAt.getTime() ?? 0));
}

/**
 * Packs conversations into batches of at most `maxMessages` messages, so small ones share
 * an AI call. A conversation longer than that is split into consecutive chunks.
 */
export function packConversations<T>(conversations: readonly T[][], maxMessages: number): T[][][] {
  const batches: T[][][] = [];
  let current: T[][] = [];
  let size = 0;
  for (const conversation of conversations) {
    for (let start = 0; start < conversation.length; start += maxMessages) {
      const chunk = conversation.slice(start, start + maxMessages);
      if (size + chunk.length > maxMessages && current.length > 0) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push(chunk);
      size += chunk.length;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
