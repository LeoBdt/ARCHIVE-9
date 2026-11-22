import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.ts";
import { profileFacts, relationships } from "../schema.ts";
import { createTestDatabase } from "../test-utils.ts";
import { recordAiUsage, runForMessage } from "./ai-usage.ts";
import { getMember, optedOutIds, upsertMember } from "./members.ts";
import { deleteMessages, lastMessageAt, recentMessages, saveMessage, setMessageReactions, updateMessageContent } from "./messages.ts";
import { forgetMember, optBackIn, profileOverview } from "./profiles.ts";
import { memberContexts, recordInteraction } from "./relationships.ts";
import { currentSelfState } from "./self-state.ts";
import { loadSettings, saveSetting } from "./settings.ts";

const url = process.env.TEST_DATABASE_URL;
const SELF = "900000000000000000";

describe.skipIf(!url)("repositories", () => {
  let conn: ReturnType<typeof createDb>;
  let db: ReturnType<typeof createDb>["db"];
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 2 });
    db = conn.db;
    for (const [id, name, isBot] of [[SELF, "ARCHIVE-9", true], ["1", "tom", false], ["2", "lea", false]] as const) {
      await upsertMember(db, { id, username: name, displayName: null, isBot, isKnownAiBot: false });
    }
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  it("seeds settings once and saves changes", async () => {
    const first = await loadSettings(db, { listenedChannelIds: ["c1"] });
    expect(first).toMatchObject({ paused: false, spontaneity: 1, listenedChannelIds: ["c1"] });
    await saveSetting(db, "paused", true, "1");
    const second = await loadSettings(db, { listenedChannelIds: ["other"] });
    expect(second).toMatchObject({ paused: true, listenedChannelIds: ["c1"] });
  });

  it("tracks nickname changes", async () => {
    await upsertMember(db, { id: "1", username: "tom", displayName: "Tomtom", isBot: false, isKnownAiBot: false });
    await upsertMember(db, { id: "1", username: "tom", displayName: "Tomtom", isBot: false, isKnownAiBot: false });
    const member = await getMember(db, "1");
    expect(member?.nameHistory.map((entry) => entry.name)).toEqual(["tom", "Tomtom"]);
  });

  it("keeps a bot recognised as an AI agent, under its new name", async () => {
    const bot = { id: "1574150367325855856", username: "cumslayer", isBot: true };
    await upsertMember(db, { ...bot, displayName: "cum slayer", isKnownAiBot: true });
    await upsertMember(db, { ...bot, displayName: "Nouveau nom", isKnownAiBot: false });
    expect(await getMember(db, bot.id)).toMatchObject({ isKnownAiBot: true, displayName: "Nouveau nom" });
  });

  it("stores, edits, reacts and deletes messages", async () => {
    const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 10, min));
    await saveMessage(db, { id: "m1", guildId: "g", channelId: "c1", authorId: "1", content: "salut", replyToId: null, mentionedIds: [], createdAt: at(0) });
    await saveMessage(db, { id: "m1", guildId: "g", channelId: "c1", authorId: "1", content: "doublon", replyToId: null, mentionedIds: [], createdAt: at(0) });
    await saveMessage(db, { id: "m2", guildId: "g", channelId: "c1", authorId: SELF, content: "yo", replyToId: "m1", mentionedIds: [], createdAt: at(1) });
    await saveMessage(db, { id: "m3", guildId: "g", channelId: "c1", authorId: "2", content: "temp", replyToId: null, mentionedIds: [], createdAt: at(2) });
    await updateMessageContent(db, "m1", "salut à tous", at(5));
    await setMessageReactions(db, "m1", { "😂": 3 });
    await deleteMessages(db, ["m3"]);
    await deleteMessages(db, []);

    const recent = await recentMessages(db, "c1", SELF, 10);
    expect(recent.map((m) => [m.id, m.content, m.isSelf])).toEqual([
      ["m1", "salut à tous", false],
      ["m2", "yo", true],
    ]);
    expect(recent[0]?.authorName).toBe("Tomtom");
    expect(recent[1]).toMatchObject({ replyToAuthorName: "Tomtom", replyToIsSelf: false });
    expect(await lastMessageAt(db, "c1", SELF)).toEqual(at(1));
    expect(await lastMessageAt(db, "c2", SELF)).toBeNull();
  });

  it("records interactions and returns participant context", async () => {
    await recordInteraction(db, "2");
    await recordInteraction(db, "2");
    const contexts = await memberContexts(db, ["1", "2"]);
    expect(contexts.get("1")).toMatchObject({ introduced: false, affinity: null });
    expect(contexts.get("2")).toMatchObject({ introduced: true, affinity: 0, trust: 50 });
    expect((await memberContexts(db, [])).size).toBe(0);
  });

  it("creates the initial self state once", async () => {
    const initial = { mood: "neuf", opinions: [], runningJokes: [], notes: "" };
    expect(await currentSelfState(db, initial)).toEqual(initial);
    expect(await currentSelfState(db, { ...initial, mood: "autre" })).toEqual(initial);
  });

  it("finds the run behind a bot message", async () => {
    const runId = randomUUID();
    const base = { runId, provider: "groq", model: "m", upstreamProvider: null, fallbackReason: null, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, costUsd: 0, durationMs: 5, status: "ok" as const, error: null };
    await recordAiUsage(db, [{ ...base, task: "triage" }, { ...base, task: "reply", replyMessageIds: ["m2"] }]);
    await recordAiUsage(db, []);
    expect((await runForMessage(db, "m2")).map((row) => row.task)).toEqual(["triage", "reply"]);
    expect(await runForMessage(db, "nope")).toEqual([]);
  });

  it("forgets a member entirely", async () => {
    await db.insert(profileFacts).values([
      { memberId: "1", category: "tastes", content: "aime le café", confidence: 0.9, nature: "fact" },
      { memberId: "2", category: "anecdotes", content: "Tom dit que Léa ronfle", confidence: 0.5, nature: "reported", reportedBy: "1" },
    ]);
    await db.insert(relationships).values({ memberId: "1" }).onConflictDoNothing();
    expect((await profileOverview(db, "1")).factCount).toBe(1);

    await forgetMember(db, "1");
    const overview = await profileOverview(db, "1");
    expect(overview).toMatchObject({ factCount: 0, messageCount: 0, summary: null, relationship: null });
    expect(overview.member?.optedOutAt).not.toBeNull();
    expect((await profileOverview(db, "2")).factCount).toBe(0);
    expect(await optedOutIds(db, ["1", "2"])).toEqual(new Set(["1"]));
    expect(await optedOutIds(db, [])).toEqual(new Set());

    await optBackIn(db, "1");
    expect(await optedOutIds(db, ["1"])).toEqual(new Set());
  });
});
