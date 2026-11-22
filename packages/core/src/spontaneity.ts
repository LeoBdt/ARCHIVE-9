export const SPONTANEITY_LEVELS = [
  { level: 0, name: "observateur", threshold: Infinity, perHour: 0 },
  { level: 1, name: "discret", threshold: 8, perHour: 2 },
  { level: 2, name: "normal", threshold: 6, perHour: 5 },
  { level: 3, name: "bavard", threshold: 4, perHour: 12 },
] as const;

export type SpontaneityLevel = (typeof SPONTANEITY_LEVELS)[number]["level"];

export function spontaneity(level: number) {
  return SPONTANEITY_LEVELS.find((entry) => entry.level === level) ?? SPONTANEITY_LEVELS[1];
}

const HOUR = 60 * 60_000;

/** Counts unprompted interventions per channel over the last hour. */
export class AmbientBudget {
  private readonly now: () => number;
  private readonly spoken = new Map<string, number[]>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private recent(channelId: string): number[] {
    const cutoff = this.now() - HOUR;
    const kept = (this.spoken.get(channelId) ?? []).filter((at) => at > cutoff);
    this.spoken.set(channelId, kept);
    return kept;
  }

  /** Whether an unprompted intervention with this interest score is allowed right now. */
  allows(channelId: string, level: number, interest: number): boolean {
    const { threshold, perHour } = spontaneity(level);
    return interest >= threshold && this.recent(channelId).length < perHour;
  }

  record(channelId: string): void {
    this.recent(channelId).push(this.now());
  }
}
