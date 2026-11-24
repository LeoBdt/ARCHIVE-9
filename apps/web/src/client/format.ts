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
  memory: { label: "ESPRIT", color: "var(--purple)" },
  system: { label: "SYSTÈME", color: "var(--faint)" },
};

export function formatCount(n: number): string {
  // French groups digits with a narrow no-break space; a plain space reads better in pixel fonts.
  return n.toLocaleString("fr-FR").replace(/\u202f/g, " ");
}

export const TIME_ZONE = "Europe/Paris";

const dayKey = (d: Date) => d.toLocaleDateString("fr-CA", { timeZone: TIME_ZONE });

/** « aujourd'hui 14:32 », « hier 00:42 », « le 21/11 à 23:10 ». */
export function when(iso: string | Date, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
  if (dayKey(date) === dayKey(now)) return `aujourd'hui ${time}`;
  if (dayKey(date) === dayKey(yesterday)) return `hier ${time}`;
  return `le ${dayMonth(date)} à ${time}`;
}

/** « 21/11 ». */
export function dayMonth(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: TIME_ZONE });
}

/** « il y a 2 h », « il y a 3 j ». */
export function ago(iso: string | Date, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${String(hours)} h`;
  return `il y a ${String(Math.round(hours / 24))} j`;
}

/** « 0,0004 $ », « 1,72 $ ». */
export function usd(n: number): string {
  const digits = n === 0 ? 0 : n < 0.01 ? 4 : n < 1 ? 3 : 2;
  return `${n.toFixed(digits).replace(".", ",")} $`;
}

/** « 912 », « 6,4 k », « 21,4 M ». */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(".", ",")} k`;
  return `${(n / 1_000_000).toFixed(1).replace(".", ",")} M`;
}

/** Version of itself in half steps: « 4,5 », « 5 ». */
export function versionText(label: number): string {
  return Number.isInteger(label) ? String(label) : label.toFixed(1).replace(".", ",");
}

/** A small Discord avatar, drawn big with hard pixels by the CSS. */
export function avatarUrl(id: string, hash: string | null, size = 32): string | null {
  return hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=${String(size)}` : null;
}

export function ms(n: number | null): string {
  if (n === null) return "?";
  return n < 1000 ? `${String(Math.round(n))} ms` : `${(n / 1000).toFixed(1).replace(".", ",")} s`;
}
