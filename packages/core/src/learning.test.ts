import { describe, expect, it } from "vitest";
import { groupConversations, packConversations } from "./conversations.ts";
import { applyAffinity, applyTrust, capDelta } from "./relationship.ts";
import { localDayAndHour, readyConversations, reflectionDue } from "./schedule.ts";
import { applySelfStateChange } from "./self-state.ts";

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, 0) + minutes * 60_000);

describe("groupConversations", () => {
  it("splits by channel and by silences longer than 15 minutes", () => {
    const messages = [
      { id: "a", channelId: "c1", createdAt: at(0) },
      { id: "c", channelId: "c1", createdAt: at(30) },
      { id: "b", channelId: "c1", createdAt: at(10) },
      { id: "x", channelId: "c2", createdAt: at(5) },
    ];
    expect(groupConversations(messages).map((c) => c.map((m) => m.id))).toEqual([["a", "b"], ["x"], ["c"]]);
    expect(groupConversations([])).toEqual([]);
  });
});

describe("packConversations", () => {
  it("shares batches between small conversations and splits long ones", () => {
    const conv = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${String(i)}`);
    const batches = packConversations([conv(2, "a"), conv(2, "b"), conv(5, "c")], 4);
    expect(batches).toEqual([
      [["a0", "a1"], ["b0", "b1"]],
      [["c0", "c1", "c2", "c3"]],
      [["c4"]],
    ]);
    expect(packConversations([], 4)).toEqual([]);
  });
});

describe("capDelta", () => {
  it("caps each change and the daily total", () => {
    expect(capDelta(12, 0)).toBe(5);
    expect(capDelta(-12, 0)).toBe(-5);
    expect(capDelta(2.6, 0)).toBe(3);
    expect(capDelta(5, 12)).toBe(3);
    expect(capDelta(5, 15)).toBe(0);
    expect(capDelta(-5, 15)).toBe(-5);
    expect(capDelta(-5, -13)).toBe(-2);
    expect(capDelta(3, 20)).toBe(0);
    expect(capDelta(0, 0)).toBe(0);
    expect(capDelta(Number.NaN, 0)).toBe(0);
  });

  it("keeps values in range", () => {
    expect(applyAffinity(98, 5)).toBe(100);
    expect(applyAffinity(-98, -5)).toBe(-100);
    expect(applyTrust(2, -5)).toBe(0);
    expect(applyTrust(50, 5)).toBe(55);
  });
});

describe("applySelfStateChange", () => {
  const current = { mood: "calme", opinions: ["a", "b", "c"], runningJokes: [], notes: "hier" };

  it("adds and removes a limited number of entries", () => {
    const next = applySelfStateChange(current, {
      mood: "  agacé ",
      opinions: { add: ["d", "B", "e", "f", " "], remove: [1, 1, 3, 2, 9] },
      runningJokes: { add: ["le serveur qui rame"], remove: [] },
      notes: "aujourd'hui",
    });
    expect(next).toEqual({ mood: "agacé", opinions: ["b", "d", "e"], runningJokes: ["le serveur qui rame"], notes: "aujourd'hui" });
  });

  it("keeps the current mood and notes when empty, and drops the oldest entries when full", () => {
    const full = { ...current, opinions: Array.from({ length: 10 }, (_, i) => `o${String(i)}`) };
    const next = applySelfStateChange(
      full,
      { mood: "", opinions: { add: ["new"], remove: [] }, runningJokes: { add: [], remove: [] }, notes: "" },
      { changesPerList: 2, maxItems: 10, maxItemLength: 160, maxMoodLength: 120, maxNotesLength: 600 },
    );
    expect(next.mood).toBe("calme");
    expect(next.notes).toBe("hier");
    expect(next.opinions).toHaveLength(10);
    expect(next.opinions[0]).toBe("o1");
    expect(next.opinions.at(-1)).toBe("new");
  });
});

describe("readyConversations", () => {
  const now = at(120);
  const conv = (...minutes: number[]) => minutes.map((m, i) => ({ id: `${String(m)}-${String(i)}`, channelId: "c", createdAt: at(m) }));
  const ids = (list: { createdAt: Date }[][]) => list.map((c) => c.map((m) => (m.createdAt.getTime() - at(0).getTime()) / 60_000));

  it("takes finished conversations in full", () => {
    expect(ids(readyConversations([conv(90, 100, 105)], now, false))).toEqual([[90, 100, 105]]);
  });

  it("waits for ongoing conversations, unless they started over an hour ago", () => {
    expect(readyConversations([conv(80, 100, 115)], now, false)).toEqual([]);
    expect(ids(readyConversations([conv(50, 100, 115)], now, false))).toEqual([[50, 100]]);
  });

  it("takes the settled part of ongoing conversations when asked", () => {
    expect(ids(readyConversations([conv(100, 108, 115)], now, true))).toEqual([[100, 108]]);
    expect(readyConversations([conv(115, 118)], now, true)).toEqual([]);
    expect(readyConversations([[]], now, true)).toEqual([]);
  });
});

describe("reflectionDue", () => {
  const tz = "Europe/Paris";
  it("runs once per local day after the given hour", () => {
    const evening = new Date("2026-07-01T21:05:00Z"); // 23:05 in Paris
    expect(localDayAndHour(evening, tz)).toEqual({ day: "2026-07-01", hour: 23 });
    expect(reflectionDue(new Date("2026-07-01T20:00:00Z"), null, tz, 23)).toBe(false);
    expect(reflectionDue(evening, null, tz, 23)).toBe(true);
    expect(reflectionDue(evening, new Date("2026-06-30T21:10:00Z"), tz, 23)).toBe(true);
    expect(reflectionDue(evening, new Date("2026-07-01T21:01:00Z"), tz, 23)).toBe(false);
  });
});
