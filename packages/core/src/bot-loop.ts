export interface BotLoopLimits {
  /** Max consecutive bot↔bot replies in a channel without a human message. */
  maxConsecutive: number;
  /** Minimum delay between two replies to a bot, in ms. */
  minIntervalMs: number;
  /** Max replies to bots per day, all channels. */
  dailyCap: number;
}

export const DEFAULT_BOT_LOOP_LIMITS: BotLoopLimits = {
  maxConsecutive: 3,
  minIntervalMs: 30_000,
  dailyCap: 40,
};

/** In the AGENTS category, bots may talk freely; the daily reply budget is the real limit. */
export const AGENTS_BOT_LOOP_LIMITS: BotLoopLimits = {
  maxConsecutive: 10,
  minIntervalMs: 10_000,
  dailyCap: Number.POSITIVE_INFINITY,
};

export type BotLoopDecision =
  | { allowed: true }
  | { allowed: false; reason: "consecutive" | "interval" | "daily_cap" };

/** Tracks exchanges with other bots to keep conversations between AIs from looping. */
export class BotLoopGuard {
  private readonly limits: BotLoopLimits;
  private readonly now: () => number;
  private readonly consecutive = new Map<string, number>();
  private lastBotReplyAt = -Infinity;
  private day = "";
  private dailyCount = 0;

  constructor(limits: BotLoopLimits = DEFAULT_BOT_LOOP_LIMITS, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  onHumanMessage(channelId: string): void {
    this.consecutive.delete(channelId);
  }

  check(channelId: string): BotLoopDecision {
    this.rollDay();
    if ((this.consecutive.get(channelId) ?? 0) >= this.limits.maxConsecutive) {
      return { allowed: false, reason: "consecutive" };
    }
    if (this.now() - this.lastBotReplyAt < this.limits.minIntervalMs) {
      return { allowed: false, reason: "interval" };
    }
    if (this.dailyCount >= this.limits.dailyCap) {
      return { allowed: false, reason: "daily_cap" };
    }
    return { allowed: true };
  }

  /** Call once ARCHIVE-9 has actually answered a bot. */
  recordReplyToBot(channelId: string): void {
    this.rollDay();
    this.consecutive.set(channelId, (this.consecutive.get(channelId) ?? 0) + 1);
    this.lastBotReplyAt = this.now();
    this.dailyCount += 1;
  }

  private rollDay(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dailyCount = 0;
    }
  }
}
