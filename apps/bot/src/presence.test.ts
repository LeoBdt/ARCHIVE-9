import { describe, expect, it } from "vitest";
import { nextDelay } from "./presence.ts";

describe("nextDelay", () => {
  it("waits between 4 and 6 hours", () => {
    const hour = 60 * 60_000;
    expect(nextDelay(() => 0)).toBe(4 * hour);
    expect(nextDelay(() => 0.5)).toBe(5 * hour);
    expect(nextDelay(() => 0.9999)).toBeLessThan(6 * hour);
  });
});
