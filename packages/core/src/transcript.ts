import { neutraliseForgedPrefixes, truncate } from "./content.ts";
import { resolveMentions } from "./directory.ts";
import type { MessageReactions } from "./domain.ts";

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
  reactions?: MessageReactions;
  createdAt: Date;
}

export interface TranscriptOptions {
  maxContentLength?: number;
  targetId?: string;
  /** Times are shown in this zone. Defaults to UTC. */
  timeZone?: string;
  /** How ARCHIVE-9's own lines are labelled. */
  selfLabel?: string;
  /** Member names by ID, to show `<@123…>` tags as `@Name`. */
  names?: ReadonlyMap<string, string>;
}

const clocks = new Map<string, Intl.DateTimeFormat>();

function time(date: Date, timeZone: string): string {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clocks.set(timeZone, clock);
  }
  return clock.format(date);
}

function formatReactions(reactions: MessageReactions | undefined): string {
  const entries = Object.entries(reactions ?? {}).filter(([, count]) => count > 0);
  return entries.length ? ` [${entries.map(([emoji, count]) => `${emoji}×${String(count)}`).join(" ")}]` : "";
}

/**
 * Renders messages as `[Name (ID 123)] : text` lines, oldest first. The prefix is added
 * here and any copy of it inside a message is neutralised, so the ID is always trustworthy.
 */
export function formatTranscript(messages: readonly TranscriptMessage[], options: TranscriptOptions = {}): string {
  const max = options.maxContentLength ?? 400;
  const timeZone = options.timeZone ?? "UTC";
  const selfLabel = options.selfLabel ?? "ARCHIVE-9 (toi)";
  return [...messages]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => {
      const who = m.isSelf ? selfLabel : `${m.authorName}${m.authorIsBot ? " [bot]" : ""}`;
      const reply = !m.replyToId
        ? ""
        : m.replyToIsSelf
          ? " ↪ à toi"
          : ` ↪ à ${m.replyToAuthorName ?? "un message plus ancien"}`;
      const target = m.id === options.targetId ? "  ◀ message cible" : "";
      const text = options.names ? resolveMentions(m.content, options.names) : m.content;
      const body = truncate(neutraliseForgedPrefixes(text.replace(/\s*\n\s*/g, " ⏎ ")), max);
      return `${time(m.createdAt, timeZone)} #${m.id}${reply} [${who} (ID ${m.authorId})] : ${body}${formatReactions(m.reactions)}${target}`;
    })
    .join("\n");
}
