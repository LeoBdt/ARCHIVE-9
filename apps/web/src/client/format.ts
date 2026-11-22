import type { FeedKind } from "./api.ts";

const PALETTE = ["#1f4a5c", "#5c3a1f", "#2a4a2a", "#3a2a4a", "#4a2a33", "#2a3a4a", "#3b2a5c", "#4a3a1f"];

/** A dim square color picked from the ID, so a member keeps theirs. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_003;
  return PALETTE[hash % PALETTE.length] ?? "#2a2a33";
}

/** "Jean Pascal" → "JP", "tom" → "T". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string) => String.fromCodePoint(word.codePointAt(0) ?? 63);
  const letters = words.length > 1 ? words.slice(0, 2).map(first) : [first(words[0] ?? "?")];
  return letters.join("").toUpperCase();
}

/** Affinity −100…100 as 0…10 lit segments. */
export function affinitySegments(affinity: number): number {
  return Math.max(0, Math.min(10, Math.round((affinity + 100) / 20)));
}

export function greeting(now: Date, timeZone: string): string {
  // fr-FR writes « 09 h »: read the hour part alone.
  const parts = new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hourCycle: "h23", timeZone }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
  if (hour < 5) return "Bonne nuit";
  return hour < 18 ? "Bonjour" : "Bonsoir";
}

export function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone });
}

export const FEED_KINDS: Record<FeedKind, { label: string; color: string }> = {
  learned: { label: "APPRIS", color: "var(--red)" },
  action: { label: "ACTION", color: "var(--blue)" },
  skill: { label: "SKILL", color: "var(--yellow)" },
  relation: { label: "RELATION", color: "var(--purple)" },
  memory: { label: "MÉMOIRE", color: "var(--faint)" },
  system: { label: "SYSTÈME", color: "var(--faint)" },
};

export function formatCount(n: number): string {
  // French groups digits with a narrow no-break space; a plain space reads better in pixel fonts.
  return n.toLocaleString("fr-FR").replace(/\u202f/g, " ");
}
