import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.ts";
import { createTestDatabase } from "../test-utils.ts";
import { logAction } from "./actions.ts";
import { addFeedback } from "./feedback.ts";
import { applyAnalysis, type AnalysisWrite } from "./learning.ts";
import { upsertMember } from "./members.ts";
import { saveMessage } from "./messages.ts";
import { saveSelfState } from "./self-state.ts";
import { actionJournal, affinityHistory, dossier, listDossiers, memoryOverview, relationsOverview } from "./site-pages.ts";

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60_000;

describe("affinityHistory", () => {
  it("rebuilds past days from the current value", () => {
    const now = Date.UTC(2026, 10, 22, 12);
    const events = [{ affinityDelta: 3, createdAt: new Date(now - 1000) }, { affinityDelta: -1, createdAt: new Date(now - 2 * DAY - 1000) }];
    expect(affinityHistory(10, events, 4, now)).toEqual([8, 7, 7, 10]);
  });
});

describe.skipIf(!url)("site pages", () => {
  let conn: ReturnType<typeof createDb>;
  let db: ReturnType<typeof createDb>["db"];
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 2 });
    db = conn.db;
    await upsertMember(db, { id: "100000000000000001", username: "tom", displayName: "Tom", isBot: false, isKnownAiBot: false });
    await upsertMember(db, { id: "100000000000000001", username: "tom", displayName: "Tomtom", isBot: false, isKnownAiBot: false });
    await upsertMember(db, { id: "100000000000000002", username: "music", displayName: null, isBot: true, isKnownAiBot: false });
    await saveMessage(db, { id: "m1", guildId: "g", channelId: "c", authorId: "100000000000000001", content: "je joue à CS2", replyToId: null, mentionedIds: [], createdAt: new Date() });
    const write: AnalysisWrite = {
      facts: [{ memberId: "100000000000000001", category: "games", nature: "fact", confidence: 0.9, content: "Joue à CS2.", sourceMessageIds: ["m1"], reportedBy: null, replacesId: null }],
      retractions: [],
      relationships: [{ memberId: "100000000000000001", affinityDelta: 4, trustDelta: 1, reason: "sympa", sourceMessageId: "m1", feeling: "complice", howTheyTreatMe: null }],
      analysedIds: ["m1"],
      at: new Date(),
    };
    await applyAnalysis(db, write);
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  it("lists dossiers, findable by a former name, without utility bots", async () => {
    expect((await listDossiers(db)).map((d) => d.name)).toEqual(["Tomtom"]);
    expect((await listDossiers(db, "tom"))[0]).toMatchObject({ facts: 1, messages: 1 });
    expect(await listDossiers(db, "personne")).toEqual([]);
  });

  it("shows a dossier with its sources, aliases and relationship", async () => {
    const d = await dossier(db, "100000000000000001");
    expect(d).toMatchObject({ name: "Tomtom", aliases: ["tom", "Tom"], relationship: { affinity: 4, feeling: "complice" } });
    expect(d?.facts[0]).toMatchObject({ content: "Joue à CS2.", source: "https://discord.com/channels/g/c/m1" });
    expect(d?.affinityHistory).toHaveLength(30);
    expect(await dossier(db, "100000000000000002")).toBeUndefined();
  });

  it("lists relations with this week's moves", async () => {
    const r = await relationsOverview(db);
    expect(r.people[0]).toMatchObject({ name: "Tomtom", affinity: 4, week: 4 });
    expect(r.moves[0]).toMatchObject({ reason: "sympa" });
  });

  it("shows the self state history and pending feedback", async () => {
    await saveSelfState(db, { mood: "calme", opinions: [], runningJokes: [], notes: "", resolutions: ["piquer moins"] }, "reflection", null);
    await addFeedback(db, "100000000000000001", "trop agressif", null);
    const m = await memoryOverview(db);
    expect(m.history[0]?.state.resolutions).toEqual(["piquer moins"]);
    expect(m.pending).toMatchObject([{ author: "Tomtom", content: "trop agressif" }]);
  });

  it("keeps pending confirmations out of the journal", async () => {
    const base = { tool: "renameChannel", tier: "controlled" as const, params: { name: "x" }, requestedBy: "100000000000000001", sourceMessageId: null };
    await logAction(db, { ...base, status: "pending" });
    await logAction(db, { ...base, status: "refused", refusalReason: "limite" });
    expect((await actionJournal(db)).map((a) => [a.status, a.requestedBy])).toEqual([["refused", "Tomtom"]]);
  });
});
