import { NoObjectGeneratedError } from "ai";
import { describe, expect, it } from "vitest";
import { CooldownTracker, DEFAULT_COOLDOWNS, parseResetDuration } from "./cooldowns.ts";
import { httpError } from "./test-utils.ts";

describe("parseResetDuration", () => {
  it.each([
    ["1m26.4s", 86_400],
    ["7.66s", 7_660],
    ["2h3m", 7_380_000],
    ["450ms", 450],
  ])("parses %s", (value, ms) => {
    expect(parseResetDuration(value)).toBe(ms);
  });

  it("returns undefined for missing or unknown values", () => {
    expect(parseResetDuration(undefined)).toBeUndefined();
    expect(parseResetDuration("soon")).toBeUndefined();
  });
});

function setup() {
  let now = 0;
  return { tracker: new CooldownTracker(() => now), advance: (ms: number) => (now += ms) };
}

describe("CooldownTracker", () => {
  it("cools a model down on 429 using retry-after", () => {
    const { tracker, advance } = setup();
    expect(tracker.recordError("m", httpError(429, { "retry-after": "10" }))).toBe("rate_limited");
    expect(tracker.blockedReason("m")).toBe("rate_limited");
    advance(10_001);
    expect(tracker.blockedReason("m")).toBeNull();
  });

  it("falls back to the request reset header, then a default", () => {
    const { tracker, advance } = setup();
    tracker.recordError("a", httpError(429, { "x-ratelimit-reset-requests": "2s" }));
    tracker.recordError("b", httpError(429));
    advance(2_001);
    expect(tracker.blockedReason("a")).toBeNull();
    expect(tracker.blockedReason("b")).toBe("rate_limited");
    advance(DEFAULT_COOLDOWNS.rateLimitedMs);
    expect(tracker.blockedReason("b")).toBeNull();
  });

  it("classifies 402, 5xx, other HTTP, invalid output and network errors", () => {
    const { tracker } = setup();
    expect(tracker.recordError("a", httpError(402))).toBe("no_credits");
    expect(tracker.recordError("b", httpError(503))).toBe("server_error");
    expect(tracker.recordError("c", httpError(400))).toBe("http_400");
    expect(tracker.blockedReason("c")).toBeNull();
    const invalid = new NoObjectGeneratedError({
      message: "bad",
      text: "x",
      response: { id: "1", timestamp: new Date(), modelId: "m" },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 0, reasoningTokens: 0 } },
      finishReason: "stop",
    });
    expect(tracker.recordError("d", invalid)).toBe("invalid_output");
    expect(tracker.blockedReason("d")).toBeNull();
    expect(tracker.recordError("e", new Error("ECONNRESET"))).toBe("error");
    expect(tracker.blockedReason("e")).toBe("network_error");
  });

  it("blocks for the rest of the day when the request quota is spent", () => {
    const { tracker, advance } = setup();
    tracker.recordHeaders("m", { "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "1m" });
    expect(tracker.blockedReason("m")).toBe("daily_quota");
    advance(60_001);
    expect(tracker.blockedReason("m")).toBeNull();
  });

  it("skips a model whose minute token budget is too small", () => {
    const { tracker, advance } = setup();
    tracker.recordHeaders("m", { "x-ratelimit-remaining-tokens": "1500", "x-ratelimit-reset-tokens": "5s" });
    expect(tracker.blockedReason("m", 1_000)).toBeNull();
    expect(tracker.blockedReason("m", 3_000)).toBe("token_budget");
    advance(5_001);
    expect(tracker.blockedReason("m", 3_000)).toBeNull();
  });

  it("ignores missing headers and keeps the longest cooldown", () => {
    const { tracker, advance } = setup();
    tracker.recordHeaders("m", undefined);
    tracker.coolDown("m", 10_000, "long");
    tracker.coolDown("m", 1_000, "short");
    advance(5_000);
    expect(tracker.blockedReason("m")).toBe("long");
  });
});
