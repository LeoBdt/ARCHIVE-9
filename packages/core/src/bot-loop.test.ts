import { describe, expect, it } from "vitest";
import { BotLoopGuard } from "./bot-loop.ts";

function setup() {
  let now = Date.parse("2026-01-01T10:00:00Z");
  const guard = new BotLoopGuard({ maxConsecutive: 2, minIntervalMs: 1_000, dailyCap: 3 }, () => now);
  return { guard, advance: (ms: number) => (now += ms) };
}

describe("BotLoopGuard", () => {
  it("allows a first reply", () => {
    expect(setup().guard.check("c1")).toEqual({ allowed: true });
  });

  it("blocks after too many consecutive bot exchanges", () => {
    const { guard, advance } = setup();
    guard.recordReplyToBot("c1");
    advance(2_000);
    guard.recordReplyToBot("c1");
    advance(2_000);
    expect(guard.check("c1")).toEqual({ allowed: false, reason: "consecutive" });
    expect(guard.check("c2")).toEqual({ allowed: true });
  });

  it("resets the streak when a human speaks", () => {
    const { guard, advance } = setup();
    guard.recordReplyToBot("c1");
    guard.recordReplyToBot("c1");
    guard.onHumanMessage("c1");
    advance(2_000);
    expect(guard.check("c1")).toEqual({ allowed: true });
  });

  it("enforces the minimum interval", () => {
    const { guard, advance } = setup();
    guard.recordReplyToBot("c1");
    advance(500);
    expect(guard.check("c2")).toEqual({ allowed: false, reason: "interval" });
    advance(600);
    expect(guard.check("c2")).toEqual({ allowed: true });
  });

  it("enforces the daily cap and resets it the next day", () => {
    const { guard, advance } = setup();
    for (const channel of ["a", "b", "c"]) {
      guard.recordReplyToBot(channel);
      advance(2_000);
    }
    expect(guard.check("d")).toEqual({ allowed: false, reason: "daily_cap" });
    advance(24 * 60 * 60 * 1000);
    expect(guard.check("d")).toEqual({ allowed: true });
  });
});
