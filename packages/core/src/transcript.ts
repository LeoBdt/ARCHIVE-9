import { neutraliseForgedPrefixes, truncate } from "./content.ts";

export interface TranscriptMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  isSelf: boolean;
  content: string;
  replyToId: string | null;
  /** Author of the replied-to message, when known. */
  replyToAuthorName?: string | null;
  replyToIsSelf?: boolean;
  createdAt: Date;
}

export interface TranscriptOptions {
  maxContentLength?: number;
  targetId?: string;
}

function time(date: Date): string {
  return date.toISOString().slice(11, 16);
}

/**
 * Renders messages as `[Name (ID 123)] : text` lines, oldest first. The prefix is added
 * here and any copy of it inside a message is neutralised, so the ID is always trustworthy.
 */
export function formatTranscript(messages: readonly TranscriptMessage[], options: TranscriptOptions = {}): string {
  const max = options.maxContentLength ?? 400;
  return [...messages]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => {
      const who = m.isSelf ? "ARCHIVE-9 (toi)" : `${m.authorName}${m.authorIsBot ? " [bot]" : ""}`;
      const reply = !m.replyToId
        ? ""
        : m.replyToIsSelf
          ? " ↪ à toi"
          : ` ↪ à ${m.replyToAuthorName ?? "un message plus ancien"}`;
      const target = m.id === options.targetId ? "  ◀ message cible" : "";
      const body = truncate(neutraliseForgedPrefixes(m.content.replace(/\s*\n\s*/g, " ⏎ ")), max);
      return `${time(m.createdAt)} #${m.id}${reply} [${who} (ID ${m.authorId})] : ${body}${target}`;
    })
    .join("\n");
}
