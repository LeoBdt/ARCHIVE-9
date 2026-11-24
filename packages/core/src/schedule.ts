import type { ChannelMessage } from "./conversations.ts";

const MINUTE = 60_000;

export const ANALYSIS_TIMING = {
  /** A conversation is over after this much silence in its channel. */
  finishedAfterMs: 15 * MINUTE,
  /** A conversation that never stops is analysed anyway once its first message is this old. */
  maxWaitMs: 60 * MINUTE,
  /** The last messages of an ongoing conversation are left for later. */
  settleMs: 10 * MINUTE,
  /** One member with this many pending messages makes ongoing conversations ready too. */
  memberThreshold: 25,
};

export type AnalysisTiming = typeof ANALYSIS_TIMING;

/**
 * Keeps the conversations ready for analysis: finished ones in full, and the settled part of
 * ongoing ones that started too long ago (or of every ongoing one when `includeOngoing`).
 */
export function readyConversations<T extends ChannelMessage>(
  conversations: readonly T[][],
  now: Date,
  includeOngoing: boolean,
  timing: AnalysisTiming = ANALYSIS_TIMING,
): T[][] {
  const ready: T[][] = [];
  for (const conversation of conversations) {
    const first = conversation[0];
    const last = conversation.at(-1);
    if (!first || !last) continue;
    if (now.getTime() - last.createdAt.getTime() >= timing.finishedAfterMs) {
      ready.push(conversation);
      continue;
    }
    if (!includeOngoing && now.getTime() - first.createdAt.getTime() < timing.maxWaitMs) continue;
    const settled = conversation.filter((m) => now.getTime() - m.createdAt.getTime() >= timing.settleMs);
    if (settled.length > 0) ready.push(settled);
  }
  return ready;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar day (`2026-11-22`) and hour of `date` in `timeZone`. */
export function localDayAndHour(date: Date, timeZone: string): { day: string; hour: number } {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""}`, hour: Number(parts.hour) };
}

/** True once a day, from `hour` local time, if no reflection happened that day yet. */
export function reflectionDue(now: Date, lastReflectionAt: Date | null, timeZone: string, hour: number): boolean {
  const today = localDayAndHour(now, timeZone);
  if (today.hour < hour) return false;
  return !lastReflectionAt || localDayAndHour(lastReflectionAt, timeZone).day !== today.day;
}

export type ReflectionKind = "midday" | "evening";

export interface ReflectionHours {
  midday: number;
  evening: number;
}

export const DEFAULT_REFLECTION_HOURS: ReflectionHours = { midday: 12, evening: 22 };

/**
 * Which reflection is due now, if any. The evening one is the big one; the midday one only
 * runs between its hour and the evening's, so a late start never stacks both.
 */
export function dueReflection(
  now: Date,
  last: { midday: Date | null; evening: Date | null },
  timeZone: string,
  hours: ReflectionHours = DEFAULT_REFLECTION_HOURS,
): ReflectionKind | null {
  if (reflectionDue(now, last.evening, timeZone, hours.evening)) return "evening";
  const { hour } = localDayAndHour(now, timeZone);
  if (hours.midday < hours.evening && hour < hours.evening && reflectionDue(now, last.midday, timeZone, hours.midday)) return "midday";
  return null;
}

/**
 * The number of a new version of itself, in half steps: day N at midday is N, the evening
 * is N,5. Anything else (rollback, first awakening) takes the next half step.
 */
export function nextVersionLabel(last: number | null, kind: ReflectionKind | "other"): number {
  if (last === null) return 1;
  if (kind === "midday") return Math.floor(last) + 1;
  if (kind === "evening") return Number.isInteger(last) ? last + 0.5 : Math.floor(last) + 1.5;
  return last + 0.5;
}

/** « 4,5 » or « 5 ». */
export function formatVersionLabel(label: number): string {
  return Number.isInteger(label) ? String(label) : label.toFixed(1).replace(".", ",");
}
