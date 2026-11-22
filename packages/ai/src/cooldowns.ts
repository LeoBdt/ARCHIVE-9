import { APICallError, NoObjectGeneratedError } from "ai";

/** Parses Groq-style reset durations: `1m26.4s`, `7.66s`, `2h3m`, `450ms`. */
export function parseResetDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(pattern)) {
    matched = true;
    const n = Number(amount);
    total += unit === "h" ? n * 3_600_000 : unit === "m" ? n * 60_000 : unit === "s" ? n * 1_000 : n;
  }
  return matched ? Math.ceil(total) : undefined;
}

type Headers = Record<string, string | undefined>;

interface TokenBudget {
  remaining: number;
  resetsAt: number;
}

export const DEFAULT_COOLDOWNS = {
  rateLimitedMs: 60_000,
  paymentRequiredMs: 60 * 60_000,
  serverErrorMs: 30_000,
  networkErrorMs: 15_000,
};

/** Remembers which models are temporarily unusable, from rate-limit headers and errors. */
export class CooldownTracker {
  private readonly now: () => number;
  private readonly until = new Map<string, { at: number; reason: string }>();
  private readonly tokens = new Map<string, TokenBudget>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Null when the model can be called with `estimatedTokens`, otherwise why not. */
  blockedReason(id: string, estimatedTokens = 0): string | null {
    const cooldown = this.until.get(id);
    if (cooldown && cooldown.at > this.now()) return cooldown.reason;
    const budget = this.tokens.get(id);
    if (budget && budget.resetsAt > this.now() && budget.remaining < estimatedTokens) {
      return "token_budget";
    }
    return null;
  }

  coolDown(id: string, ms: number, reason: string): void {
    const at = this.now() + ms;
    const current = this.until.get(id);
    if (!current || current.at < at) this.until.set(id, { at, reason });
  }

  /** Reads `x-ratelimit-*` headers from a successful response. */
  recordHeaders(id: string, headers: Headers | undefined): void {
    if (!headers) return;
    const remainingRequests = Number(headers["x-ratelimit-remaining-requests"]);
    if (headers["x-ratelimit-remaining-requests"] !== undefined && remainingRequests <= 0) {
      const ms = parseResetDuration(headers["x-ratelimit-reset-requests"]) ?? DEFAULT_COOLDOWNS.rateLimitedMs;
      this.coolDown(id, ms, "daily_quota");
    }
    const remainingTokens = headers["x-ratelimit-remaining-tokens"];
    if (remainingTokens !== undefined) {
      const resetMs = parseResetDuration(headers["x-ratelimit-reset-tokens"]) ?? 60_000;
      this.tokens.set(id, { remaining: Number(remainingTokens), resetsAt: this.now() + resetMs });
    }
  }

  /** Cools a model down after a failed call. Returns the reason that was recorded. */
  recordError(id: string, error: unknown): string {
    if (NoObjectGeneratedError.isInstance(error)) return "invalid_output";
    if (APICallError.isInstance(error)) {
      const status = error.statusCode;
      if (status === 429) {
        const headers = error.responseHeaders ?? {};
        const retryAfter = headers["retry-after"];
        const ms =
          (retryAfter !== undefined && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : undefined) ??
          parseResetDuration(headers["x-ratelimit-reset-requests"]) ??
          DEFAULT_COOLDOWNS.rateLimitedMs;
        this.coolDown(id, ms, "rate_limited");
        return "rate_limited";
      }
      if (status === 402) {
        this.coolDown(id, DEFAULT_COOLDOWNS.paymentRequiredMs, "no_credits");
        return "no_credits";
      }
      if (status !== undefined && status >= 500) {
        this.coolDown(id, DEFAULT_COOLDOWNS.serverErrorMs, "server_error");
        return "server_error";
      }
      return `http_${String(status ?? "unknown")}`;
    }
    this.coolDown(id, DEFAULT_COOLDOWNS.networkErrorMs, "network_error");
    return "error";
  }
}
