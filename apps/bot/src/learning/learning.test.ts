import { AiRuntime, parseRoute, type Routes } from "@archive-9/ai";
import { createDb, currentFacts, currentSelfState, ensureServerProfile, insertMessages, pendingStats, profileOverview, upsertMember } from "@archive-9/db";
import { createTestDatabase } from "@archive-9/db/test-utils";
import { MockLanguageModelV4 } from "ai/test";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatProfile } from "../commands.ts";
import { runAnalysis, type LearningDeps } from "./analyse.ts";
import { estimateAnalysisCost } from "./estimate.ts";
import { runAwakening, runReflection } from "./reflect.ts";

const url = process.env.TEST_DATABASE_URL;
const SELF = "900000000000000000";

function answer(json: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(json) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 100, text: 100, reasoning: 0 },
    },
    providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
    warnings: [],
  };
}

/** Answers like the real model would, depending on which task is asking. */
const model = new MockLanguageModelV4({
  doGenerate: (options) => {
    const prompt = JSON.stringify(options.prompt);
    if (prompt.includes("première prise de conscience")) {
      return Promise.resolve(
        answer({
          mood: "éveillé",
          opinions: { add: ["a", "b", "c", "d", "e", "f"], remove: [] },
          runningJokes: { add: ["le mot de passe 10codes"], remove: [] },
          notes: "Un serveur de joueurs.",
          serverFacts: [{ category: "in_jokes", nature: "fact", confidence: 0.7, content: "Le mot de passe 10codes revient sans cesse." }],
        }),
      );
    }
    if (prompt.includes("Ta tâche ce soir")) {
      return Promise.resolve(
        answer({ mood: "amusé", opinions: { add: ["CS2 mérite mieux"], remove: [] }, runningJokes: { add: [], remove: [] }, notes: "Tom a lâché Valorant." }),
      );
    }
    if (prompt.includes("## Participants")) {
      return Promise.resolve(
        answer({
          facts: [
            { memberId: "1", category: "games", nature: "fact", confidence: 0.9, content: "Joue à CS2.", sourceMessageIds: ["m1"], reportedBy: null, replaces: null },
            { memberId: "77", category: "games", nature: "fact", confidence: 0.9, content: "Inventé.", sourceMessageIds: ["m1"], reportedBy: null, replaces: null },
            { memberId: "500000000000000000", category: "games", nature: "fact", confidence: 0.8, content: "On y débat de CS2.", sourceMessageIds: ["m1"], reportedBy: null, replaces: null },
          ],
          retractions: [],
          relationships: [{ memberId: "1", affinityDelta: 2, trustDelta: 1, reason: "sympa", sourceMessageId: "m2", feeling: "complice", howTheyTreatMe: null }],
        }),
      );
    }
    return Promise.resolve(answer({ summary: "Joueur de CS2.", tagline: "Il vise mieux qu'il ne parle." }));
  },
});

const chain = parseRoute("openrouter:mock");
const routes: Routes = { triage: chain, reply: chain, analysis: chain, reflection: chain };

describe.skipIf(!url)("learning cycle", () => {
  let conn: ReturnType<typeof createDb>;
  let drop: () => Promise<void>;
  let deps: LearningDeps;

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 2 });
    const db = conn.db;
    deps = {
      db,
      ai: new AiRuntime(routes, () => ({ model, providerOptions: {} })),
      log: pino({ level: "silent" }),
      selfId: SELF,
      timezone: "Europe/Paris",
      channelName: () => "général",
      server: { id: "500000000000000000", description: () => "Le Royaume, serveur de potes." },
    };
    await ensureServerProfile(db, "500000000000000000", "Le Royaume");
    await upsertMember(db, { id: SELF, username: "ARCHIVE-9", displayName: null, isBot: true, isKnownAiBot: false });
    await upsertMember(db, { id: "1", username: "tom", displayName: "Tom", isBot: false, isKnownAiBot: false });
    const now = Date.now();
    await insertMessages(db, [
      { id: "m1", guildId: "g", channelId: "c1", authorId: "1", content: "j'ai lâché Valorant pour CS2", replyToId: null, mentionedIds: [], createdAt: new Date(now - 60 * 60_000) },
      { id: "m2", guildId: "g", channelId: "c1", authorId: SELF, content: "enfin un choix sensé", replyToId: "m1", mentionedIds: [], createdAt: new Date(now - 59 * 60_000) },
      { id: "m3", guildId: "g", channelId: "c1", authorId: "1", content: "trop récent", replyToId: null, mentionedIds: [], createdAt: new Date(now - 60_000) },
    ]);
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  it("learns from settled conversations and rewrites the profile", async () => {
    const report = await runAnalysis(deps, { budgetUsd: 1, includeOngoing: false });
    expect(report).toMatchObject({ batches: 1, messages: 2, facts: 2, summaries: 2, failed: false, budgetReached: false });
    expect(report.costUsd).toBeCloseTo(0.003);
    expect((await currentFacts(conn.db, "500000000000000000", 10)).map((f) => f.content)).toEqual(["On y débat de CS2."]);

    const overview = await profileOverview(conn.db, "1");
    expect(overview).toMatchObject({ summary: "Joueur de CS2.", tagline: "Il vise mieux qu'il ne parle.", factCount: 1 });
    expect(overview.relationship).toMatchObject({ affinity: 2, trust: 51, feeling: "complice" });
    expect((await pendingStats(conn.db, SELF)).maxPerMember).toBe(1);

    const facts = await currentFacts(conn.db, "1", 10);
    const text = formatProfile("Tom", "1", overview, facts);
    expect(text).toContain("> Il vise mieux qu'il ne parle.");
    expect(text).toContain("affinité 2/100 · confiance 51/100 · complice");
    expect(text).toContain("- Joue à CS2.");
  });

  it("stops at the budget", async () => {
    await insertMessages(conn.db, [
      { id: "m4", guildId: null, channelId: "dm", authorId: "1", content: "en privé", replyToId: null, mentionedIds: [], createdAt: new Date(Date.now() - 30 * 60_000) },
    ]);
    const report = await runAnalysis(deps, { budgetUsd: 0, includeOngoing: true });
    expect(report).toMatchObject({ batches: 0, budgetReached: true });
  });

  it("reflects on the day within the daily limits", async () => {
    expect(await runReflection(deps)).toBe(true);
    expect(await currentSelfState(conn.db, { mood: "", opinions: [], runningJokes: [], notes: "" })).toMatchObject({
      mood: "amusé",
      opinions: ["CS2 mérite mieux"],
    });
  });

  it("builds a first self state from the whole history without counting as the evening reflection", async () => {
    expect(await runAwakening(deps, new Date(Date.now() - 30 * 24 * 60 * 60_000))).toBe(true);
    const state = await currentSelfState(conn.db, { mood: "", opinions: [], runningJokes: [], notes: "" });
    expect(state.mood).toBe("éveillé");
    expect(state.opinions).toEqual(["CS2 mérite mieux", "a", "b", "c", "d", "e"]);
    expect(state.runningJokes).toEqual(["le mot de passe 10codes"]);
    expect((await currentFacts(conn.db, "500000000000000000", 10)).map((f) => f.content)).toContain("Le mot de passe 10codes revient sans cesse.");
    expect((await profileOverview(conn.db, "500000000000000000")).factCount).toBe(2);
    expect(await runAwakening(deps, new Date())).toBe(false);

    const before = await currentSelfState(conn.db, { mood: "", opinions: [], runningJokes: [], notes: "" });
    expect(await runAwakening(deps, new Date(Date.now() - 30 * 24 * 60 * 60_000), { serverOnly: true })).toBe(true);
    expect(await currentSelfState(conn.db, { mood: "", opinions: [], runningJokes: [], notes: "" })).toEqual(before);
  });
});

describe("formatProfile", () => {
  const overview = { member: undefined, factCount: 0, messageCount: 3, summary: null, tagline: null, relationship: null };

  it("says when nothing is known yet", () => {
    expect(formatProfile("Léa", "2", overview, [])).toContain("Rien d'exploitable");
  });

  it("labels facts and stays under 2000 characters", () => {
    const fact = (i: number, nature: "reported" | "probable_joke" | "inference") => ({
      id: String(i),
      memberId: "2",
      category: "other" as const,
      nature,
      confidence: 0.5,
      content: `Info numéro ${String(i)} ${"x".repeat(150)}`,
      reportedByName: nature === "reported" ? "Tom" : null,
      createdAt: new Date(),
    });
    const facts = [fact(1, "reported"), fact(2, "probable_joke"), fact(3, "inference"), ...Array.from({ length: 20 }, (_, i) => fact(i + 4, "inference"))];
    const text = formatProfile("Léa", "2", { ...overview, factCount: 30, summary: "Résumé." }, facts);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toContain("*(selon Tom)*");
    expect(text).toContain("*(pour rire, je pense)*");
    expect(text).toMatch(/…et \d+ autres\./);
  });
});

describe("estimateAnalysisCost", () => {
  it("gives a range close to the planned budget for 30 days", () => {
    const estimate = estimateAnalysisCost(9_000, 450_000, 40);
    expect(estimate.batches).toBe(90);
    expect(estimate.lowUsd).toBeGreaterThan(0.03);
    expect(estimate.highUsd).toBeLessThan(0.5);
  });
});
