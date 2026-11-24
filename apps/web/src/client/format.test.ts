import { describe, expect, it } from "vitest";
import { affinitySegments, avatarColor, avatarUrl, formatCount, greeting, initials, tokens, usd, versionText, when } from "./format.ts";

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

  it("says when, plainly", () => {
    const now = new Date("2026-11-24T13:00:00Z");
    expect(when("2026-11-24T12:32:00Z", now)).toBe("aujourd'hui 13:32");
    expect(when("2026-11-23T23:42:00Z", now)).toBe("aujourd'hui 00:42");
    expect(when("2026-11-23T10:00:00Z", now)).toBe("hier 11:00");
    expect(when("2026-11-20T22:10:00Z", now)).toBe("le 20/11 à 23:10");
  });

  it("formats money, tokens, versions and avatars", () => {
    expect([0.0004, 0.42, 3.9].map(usd)).toEqual(["0,0004 $", "0,420 $", "3,90 $"]);
    expect([912, 6412, 21_400_000].map(tokens)).toEqual(["912", "6,4 k", "21,4 M"]);
    expect([4.5, 5].map(versionText)).toEqual(["4,5", "5"]);
    expect(avatarUrl("1", "abc", 16)).toBe("https://cdn.discordapp.com/avatars/1/abc.png?size=16");
    expect(avatarUrl("1", null)).toBeNull();
  });
});
