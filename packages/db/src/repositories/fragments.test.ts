import { parseSearchQuery } from "@archive-9/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "../client.ts";
import { createTestDatabase } from "../test-utils.ts";
import { createCategory, listCategories } from "./categories.ts";
import { applyPlannedOperation, deleteFact, dossierFacts, factByRef, mergeFacts, recordFactOperation, rewriteFact } from "./fragments.ts";
import { applyAnalysis, correctOwnFact, type AnalysisWrite } from "./learning.ts";
import { saveMessage } from "./messages.ts";
import { upsertMember } from "./members.ts";
import { searchArchives } from "./search.ts";

const url = process.env.TEST_DATABASE_URL;
const TOM = "100000000000000001";
const LEA = "100000000000000002";

describe.skipIf(!url)("fragments", () => {
  let conn: ReturnType<typeof createDb>;
  let drop: () => Promise<void>;
  let db: Database;
  const fact = (content: string, over: Partial<AnalysisWrite["facts"][number]> = {}): AnalysisWrite["facts"][number] => ({
    memberId: TOM,
    category: "other",
    nature: "fact",
    confidence: 0.8,
    content,
    sourceMessageIds: ["m1"],
    reportedBy: null,
    replacesId: null,
    ...over,
  });
  const learn = (facts: AnalysisWrite["facts"]) => applyAnalysis(db, { facts, retractions: [], relationships: [], analysedIds: [], at: new Date() });

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 2 });
    db = conn.db;
    await upsertMember(db, { id: TOM, username: "tom", displayName: "Tom", isBot: false, isKnownAiBot: false });
    await upsertMember(db, { id: LEA, username: "lea", displayName: "Léa", isBot: false, isKnownAiBot: false });
    await saveMessage(db, { id: "m1", guildId: "g", channelId: "c", authorId: TOM, content: "je fais mes pâtes moi-même", replyToId: null, mentionedIds: [], createdAt: new Date() });
    await learn([fact("Fait ses pâtes lui-même."), fact("Joue à Valorant le soir.", { category: "games" }), fact("A une moto rouge."), fact("Répare sa moto le dimanche."), fact("Rêve d'une moto japonaise.")]);
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  it("numbers fragments, merges a near duplicate into the one it repeats", async () => {
    await learn([fact("Fait ses pâtes lui-même !", { sourceMessageIds: ["m1"] })]);
    const facts = await dossierFacts(db, TOM);
    expect(facts.map((f) => f.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(facts.map((f) => f.number)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(facts.map((f) => f.ref)).size).toBe(5);
  });

  it("keeps the number and the reference through a correction and a rewrite", async () => {
    const [first] = await dossierFacts(db, TOM);
    const corrected = await correctOwnFact(db, TOM, first?.id ?? "", "Fait ses pâtes et sa pizza.", "plus précis", "site");
    const rewritten = await rewriteFact(db, corrected?.newId ?? "", "Fait ses pâtes et sa pizza maison.");
    const after = (await dossierFacts(db, TOM)).find((f) => f.id === rewritten);
    expect(after).toMatchObject({ number: 1, rank: 1, ref: first?.ref, content: "Fait ses pâtes et sa pizza maison." });
    const history = await factByRef(db, first?.ref ?? "");
    expect(history?.versions).toHaveLength(3);
    expect(history?.current).toBe(true);
  });

  it("merges and deletes; ranks close up, numbers never move", async () => {
    const facts = await dossierFacts(db, TOM);
    const [, valo, moto, repair] = facts;
    expect(await mergeFacts(db, moto?.id ?? "", [repair?.id ?? ""], "A une moto rouge qu'il répare le dimanche.", "archive-9")).not.toBeNull();
    expect(await deleteFact(db, valo?.id ?? "", "archive-9")).toBe(true);
    const left = await dossierFacts(db, TOM);
    expect(left.map((f) => [f.number, f.rank])).toEqual([
      [1, 1],
      [3, 2],
      [5, 3],
    ]);
    await learn([fact("Vit à Lyon.", { category: "identity" })]);
    expect((await dossierFacts(db, TOM)).at(-1)).toMatchObject({ number: 6, rank: 4 });
  });

  it("applies a planned deletion only while the fragment is still there", async () => {
    const [, , last] = await dossierFacts(db, TOM);
    const id = await recordFactOperation(db, { memberId: TOM, factId: last?.id ?? null, op: "delete", status: "planned", reason: "test", details: {}, run: "nightly" });
    expect(await applyPlannedOperation(db, id, "admin")).toBe("applied");
    const again = await recordFactOperation(db, { memberId: TOM, factId: last?.id ?? null, op: "delete", status: "planned", reason: "test", details: {}, run: "nightly" });
    expect(await applyPlannedOperation(db, again, "admin")).toBe("failed");
  });

  it("opens a personal drawer that only this dossier sees", async () => {
    await learn([fact("Collectionne les vinyles.", { memberId: LEA }), fact("Écoute du jazz.", { memberId: LEA }), fact("Va à des concerts.", { memberId: LEA })]);
    const ids = (await dossierFacts(db, LEA)).map((f) => f.id);
    const made = await createCategory(db, { label: "Musique", reason: "trois fragments", factIds: ids, memberId: LEA });
    expect(made.ok).toBe(true);
    expect((await listCategories(db, LEA)).some((c) => c.label === "Musique" && c.memberId === LEA)).toBe(true);
    expect((await listCategories(db, TOM)).some((c) => c.label === "Musique")).toBe(false);
    expect((await dossierFacts(db, LEA)).every((f) => f.category.startsWith("musique~"))).toBe(true);
  });

  it("finds fragments by words, close spelling, person, reference and rank", async () => {
    const viewer = { id: LEA, isAdmin: false };
    const options = { publicChannelIds: ["c"] };
    const byWord = await searchArchives(db, parseSearchQuery("pates"), viewer, options);
    expect(byWord.fragments[0]?.content).toContain("pâtes");
    expect(byWord.messages[0]?.id).toBe("m1");
    expect((await searchArchives(db, parseSearchQuery("vinyle"), viewer, options)).fragments[0]?.memberName).toBe("Léa");
    const [first] = await dossierFacts(db, TOM);
    expect((await searchArchives(db, parseSearchQuery(`#${first?.ref ?? ""}`), viewer, options)).fragments).toHaveLength(1);
    expect((await searchArchives(db, parseSearchQuery("@tom F002"), viewer, options)).fragments.map((f) => f.rank)).toEqual([2]);
    expect((await searchArchives(db, parseSearchQuery("@personne pizza"), viewer, options)).fragments).toEqual([]);
    expect((await searchArchives(db, parseSearchQuery("pates"), viewer, { publicChannelIds: [] })).messages).toEqual([]);
  });
});
