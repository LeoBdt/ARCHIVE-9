import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, notify, withAdvisoryLock } from "../client.ts";
import { relationshipEvents, relationships } from "../schema.ts";
import { createTestDatabase } from "../test-utils.ts";
import { aiCostSince, recordAiUsage } from "./ai-usage.ts";
import {
  applyAnalysis,
  currentFacts,
  deleteSummary,
  factsSince,
  participantProfiles,
  relationshipEventsSince,
  saveSummary,
  type AnalysisWrite,
} from "./learning.ts";
import { ensureMember, ensureServerProfile, getMember, upsertMember } from "./members.ts";
import {
  contextBefore,
  existingMessageIds,
  insertMessages,
  markAnalysed,
  messagesSince,
  pendingMessages,
  pendingStats,
  purgeMessages,
  recentWithMember,
} from "./messages.ts";
import { forgetMember, profileOverview } from "./profiles.ts";
import { currentSelfState, lastReflectionAt, saveSelfState } from "./self-state.ts";

const url = process.env.TEST_DATABASE_URL;
const SELF = "900000000000000000";
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 10, 0) + minutes * 60_000);
const message = (id: string, authorId: string, minute: number, channelId = "c1") => ({
  id,
  guildId: "g",
  channelId,
  authorId,
  content: `message ${id}`,
  replyToId: null,
  mentionedIds: [],
  createdAt: at(minute),
});

describe.skipIf(!url)("learning repositories", () => {
  let conn: ReturnType<typeof createDb>;
  let db: ReturnType<typeof createDb>["db"];
  let drop: () => Promise<void>;

  const write = (over: Partial<AnalysisWrite>): AnalysisWrite => ({ facts: [], retractions: [], relationships: [], analysedIds: [], at: at(0), ...over });
  const fact = (over: Partial<AnalysisWrite["facts"][number]> = {}): AnalysisWrite["facts"][number] => ({
    memberId: "1",
    category: "games",
    nature: "fact",
    confidence: 0.9,
    content: "Joue à Valorant.",
    sourceMessageIds: ["m1"],
    reportedBy: null,
    replacesId: null,
    ...over,
  });
  const relation = (over: Partial<AnalysisWrite["relationships"][number]> = {}): AnalysisWrite["relationships"][number] => ({
    memberId: "1",
    affinityDelta: 5,
    trustDelta: -5,
    reason: "test",
    sourceMessageId: null,
    feeling: null,
    howTheyTreatMe: null,
    ...over,
  });

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 3 });
    db = conn.db;
    for (const [id, name, isBot] of [[SELF, "ARCHIVE-9", true], ["1", "tom", false], ["2", "lea", false], ["3", "max", false]] as const) {
      await upsertMember(db, { id, username: name, displayName: null, isBot, isKnownAiBot: false });
    }
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  it("inserts only new messages and finds pending ones", async () => {
    const inserted = await insertMessages(db, [message("m1", "1", 0), message("m2", "2", 1), message("m3", SELF, 2), message("m4", "1", 3, "c2")]);
    expect(inserted.sort()).toEqual(["m1", "m2", "m3", "m4"]);
    expect(await insertMessages(db, [message("m1", "1", 0), { ...message("m5", "2", 20), reactions: { "😂": 2 } }])).toEqual(["m5"]);
    expect(await existingMessageIds(db, ["m1", "nope"])).toEqual(new Set(["m1"]));

    const pending = await pendingMessages(db, SELF, at(10), 100);
    expect(pending.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(pending[2]).toMatchObject({ isSelf: true, channelId: "c1" });
    expect((await messagesSince(db, SELF, at(15), 10))[0]?.reactions).toEqual({ "😂": 2 });

    const stats = await pendingStats(db, SELF);
    expect(stats).toEqual({ oldestAt: at(0), maxPerMember: 2 });
  });

  it("returns analysed context before a conversation", async () => {
    await markAnalysed(db, ["m1", "m2"]);
    const context = await contextBefore(db, SELF, "c1", { since: at(-10), before: at(2) }, 5);
    expect(context.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(await contextBefore(db, SELF, "c1", { since: at(1), before: at(2) }, 5)).toHaveLength(1);
  });

  it("writes facts, corrections and retractions, then marks messages", async () => {
    expect(await applyAnalysis(db, write({ facts: [fact(), fact({ memberId: "2", content: "Ronfle.", nature: "reported", reportedBy: "1" })] }))).toEqual(
      expect.arrayContaining(["1", "2"]),
    );
    const [old] = await currentFacts(db, "1", 10);
    expect(old?.content).toBe("Joue à Valorant.");

    const touched = await applyAnalysis(db, write({ facts: [fact({ content: "Joue à CS2.", replacesId: old?.id ?? null })], analysedIds: ["m3"] }));
    expect(touched).toEqual(["1"]);
    expect((await currentFacts(db, "1", 10)).map((f) => f.content)).toEqual(["Joue à CS2."]);
    expect((await pendingMessages(db, SELF, at(10), 10)).map((m) => m.id)).toEqual(["m4"]);

    const [lea] = await currentFacts(db, "2", 10);
    expect(lea?.reportedByName).toBe("tom");
    expect(await applyAnalysis(db, write({ retractions: [{ factId: lea?.id ?? "", memberId: "1" }] }))).toEqual([]);
    expect(await applyAnalysis(db, write({ retractions: [{ factId: lea?.id ?? "", memberId: "2" }] }))).toEqual(["2"]);
    expect(await currentFacts(db, "2", 10)).toEqual([]);

    const learned = await factsSince(db, at(-60), 10);
    expect(learned.map((f) => [f.memberName, f.content])).toEqual([["tom", "Joue à CS2."]]);
  });

  it("caps relationship changes per day and keeps feelings", async () => {
    await applyAnalysis(db, write({ relationships: [relation({ affinityDelta: 9, feeling: "complice" })] }));
    await applyAnalysis(db, write({ relationships: [relation({ howTheyTreatMe: "gentil" })], at: at(60) }));
    await applyAnalysis(db, write({ relationships: [relation()], at: at(120) }));
    await applyAnalysis(db, write({ relationships: [relation()], at: at(180) }));
    await applyAnalysis(db, write({ relationships: [relation({ affinityDelta: 0, trustDelta: 0 })], at: at(200) }));

    const profiles = await participantProfiles(db, ["1", "3", "unknown"], 5);
    const tom = profiles.find((p) => p.id === "1");
    expect(tom).toMatchObject({ affinity: 15, trust: 35, feeling: "complice", facts: [{ content: "Joue à CS2." }] });
    expect(profiles.find((p) => p.id === "3")).toMatchObject({ affinity: null, facts: [] });
    expect(profiles).toHaveLength(2);
    const [row] = await db.select().from(relationships);
    expect(row).toMatchObject({ howTheyTreatMe: "gentil", introducedAt: null });
    expect(await db.select().from(relationshipEvents)).toHaveLength(3);

    // A day later the budget is back.
    await applyAnalysis(db, write({ relationships: [relation()], at: at(24 * 60 + 1) }));
    expect((await participantProfiles(db, ["1"], 5))[0]?.affinity).toBe(20);
    expect((await relationshipEventsSince(db, at(0), 10))[0]).toMatchObject({ memberName: "tom", affinityDelta: 5 });
  });

  it("keeps a profile row for the server", async () => {
    await ensureServerProfile(db, "500", "Royaume");
    await ensureServerProfile(db, "500", "Le Royaume");
    expect(await getMember(db, "500")).toMatchObject({ username: "Le Royaume", isServer: true, isBot: false });
    expect((await participantProfiles(db, ["500"], 5))[0]).toMatchObject({ isServer: true, name: "Le Royaume" });
  });

  it("never writes about opted-out members", async () => {
    await ensureMember(db, { id: "4", username: "zoe", displayName: null, isBot: false, isKnownAiBot: false });
    await forgetMember(db, "4");
    const touched = await applyAnalysis(db, write({ facts: [fact({ memberId: "4" }), fact({ memberId: "3", reportedBy: "4" })], relationships: [relation({ memberId: "4" })] }));
    expect(touched).toEqual([]);
    expect(await participantProfiles(db, ["4"], 5)).toEqual([]);
    await ensureMember(db, { id: "4", username: "other", displayName: null, isBot: false, isKnownAiBot: false });
    expect((await getMember(db, "4"))?.username).toBe("zoe");
  });

  it("remembers what a member said elsewhere, with ARCHIVE-9's replies", async () => {
    const recent = new Date(Date.now() - 60_000);
    await insertMessages(db, [
      { ...message("s1", "3", 0, "dm-3"), guildId: null, createdAt: recent },
      { ...message("s2", SELF, 0, "dm-3"), guildId: null, replyToId: "s1", createdAt: new Date(recent.getTime() + 1_000) },
      { ...message("s3", "2", 0, "c9"), createdAt: recent },
      { ...message("s4", "3", 0, "c9"), createdAt: new Date(recent.getTime() + 2_000) },
    ]);
    const memory = await recentWithMember(db, SELF, "3", { since: new Date(Date.now() - 3_600_000), excludeIds: ["s4"], limit: 10 });
    expect(memory.map((m) => [m.id, m.guildId])).toEqual([["s1", null], ["s2", null]]);
    expect(await recentWithMember(db, SELF, "3", { since: new Date(), excludeIds: [], limit: 10 })).toEqual([]);

    await forgetMember(db, "3");
    expect(await existingMessageIds(db, ["s1", "s2", "s3", "s4"])).toEqual(new Set(["s3"]));
  });

  it("saves and deletes summaries", async () => {
    await saveSummary(db, { memberId: "1", summary: "Joueur.", tagline: "Il vise.", factCount: 1, model: "m" });
    await saveSummary(db, { memberId: "1", summary: "Joueur de CS2.", tagline: null, factCount: 1, model: "m" });
    expect(await profileOverview(db, "1")).toMatchObject({ summary: "Joueur de CS2.", tagline: null });
    await deleteSummary(db, "1");
    expect((await profileOverview(db, "1")).summary).toBeNull();
  });

  it("versions the self state", async () => {
    const initial = { mood: "neuf", opinions: [], runningJokes: [], notes: "" };
    await currentSelfState(db, initial);
    expect(await lastReflectionAt(db)).toBeNull();
    const version = await saveSelfState(db, { ...initial, mood: "amusé" }, "reflection", null);
    expect(version).toBe(2);
    expect(await currentSelfState(db, initial)).toMatchObject({ mood: "amusé" });
    expect(await lastReflectionAt(db)).toBeInstanceOf(Date);
  });

  it("sums AI costs, purges old messages, notifies and locks", async () => {
    const base = { runId: randomUUID(), provider: "openrouter", model: "m", upstreamProvider: null, fallbackReason: null, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, durationMs: 1, status: "ok" as const, error: null };
    await recordAiUsage(db, [{ ...base, task: "analysis", costUsd: 0.002 }, { ...base, task: "analysis", costUsd: null }, { ...base, task: "reply", costUsd: 1 }]);
    expect(await aiCostSince(db, ["analysis"], at(0))).toBeCloseTo(0.002);
    expect(await aiCostSince(db, ["reflection"], at(0))).toBe(0);

    expect(await purgeMessages(db, at(2))).toBe(2);
    expect(await existingMessageIds(db, ["m1", "m3"])).toEqual(new Set(["m3"]));

    await notify(db, { type: "test" });

    const outer = await withAdvisoryLock(conn.client, 42, async () => {
      const inner = await withAdvisoryLock(conn.client, 42, () => Promise.resolve("inner"));
      return inner.acquired;
    });
    expect(outer).toEqual({ acquired: true, value: false });
    expect(await withAdvisoryLock(conn.client, 42, () => Promise.resolve(1))).toEqual({ acquired: true, value: 1 });
  });
});
