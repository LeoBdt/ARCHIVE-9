import { describe, expect, it } from "vitest";
import { affinitySegments, avatarColor, formatCount, greeting, initials } from "./format.ts";

describe("client helpers", () => {
  it("builds initials", () => {
    expect(initials("Jean Pascal")).toBe("JP");
    expect(initials("tom")).toBe("T");
    expect(initials("  ")).toBe("?");
  });

  it("maps affinity to ten segments", () => {
    expect([-100, 0, 42, 100].map(affinitySegments)).toEqual([0, 5, 7, 10]);
  });

  it("keeps a member's color", () => {
    expect(avatarColor("123")).toBe(avatarColor("123"));
  });

  it("greets by the hour in Paris", () => {
    expect(greeting(new Date("2026-11-22T08:00:00Z"), "Europe/Paris")).toBe("Bonjour");
    expect(greeting(new Date("2026-11-22T19:00:00Z"), "Europe/Paris")).toBe("Bonsoir");
    expect(greeting(new Date("2026-11-22T01:00:00Z"), "Europe/Paris")).toBe("Bonne nuit");
  });

  it("formats counts with plain spaces", () => {
    expect(formatCount(5899)).toBe("5 899");
  });
});
