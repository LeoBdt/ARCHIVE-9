const HOUR = 60 * 60_000;

export const ANALYSIS_TRIGGER = {
  /** Analyse once the oldest pending message is this old. */
  maxWaitMs: 4 * HOUR,
  /** Or as soon as one member has this many pending messages. */
  memberThreshold: 25,
};

export interface PendingStats {
  oldestAt: Date | null;
  maxPerMember: number;
}

export function analysisDue(stats: PendingStats, now: Date, trigger = ANALYSIS_TRIGGER): boolean {
  if (!stats.oldestAt) return false;
  return stats.maxPerMember >= trigger.memberThreshold || now.getTime() - stats.oldestAt.getTime() >= trigger.maxWaitMs;
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
