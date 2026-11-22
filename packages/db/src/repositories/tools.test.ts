import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.ts";
import { createTestDatabase } from "../test-utils.ts";
import { claimPending, countActions, finishAction, getAction, logAction, markUndone, recentControlledActions, reopenAction } from "./actions.ts";
import { upsertMember } from "./members.ts";
import { forgetMember } from "./profiles.ts";
import { activeSkills, createSkill, deleteSkill, findActiveSkill, recordSkillUse, skillCounts } from "./skills.ts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("skills and actions", () => {
  let conn: ReturnType<typeof createDb>;
  let db: ReturnType<typeof createDb>["db"];
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 2 });
    db = conn.db;
    for (const [id, name] of [["1", "tom"], ["2", "lea"]] as const) {
      await upsertMember(db, { id, username: name, displayName: null, isBot: false, isKnownAiBot: false });
    }
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  it("creates skills with unique active names", async () => {
    const id = await createSkill(db, { name: "Pizza", kind: "triggered", triggers: ["pizza"], rule: "L'ananas est un crime." }, "1");
    expect(id).not.toBeNull();
    expect(await createSkill(db, { name: "pizza", kind: "permanent", triggers: [], rule: "Autre consigne." }, "2")).toBeNull();
    await createSkill(db, { name: "Météo", kind: "permanent", triggers: [], rule: "Parle de la pluie." }, "2");

    expect(await skillCounts(db, "1")).toEqual({ total: 2, byAuthor: 1, permanent: 1 });
    const skills = await activeSkills(db);
    expect(skills.map((s) => [s.name, s.authorName])).toEqual([["Pizza", "tom"], ["Météo", "lea"]]);

    await recordSkillUse(db, [id ?? ""]);
    expect((await findActiveSkill(db, " PIZZA "))?.usageCount).toBe(1);

    expect(await deleteSkill(db, id ?? "", "1")).toBe(true);
    expect(await deleteSkill(db, id ?? "", "1")).toBe(false);
    expect(await createSkill(db, { name: "Pizza", kind: "permanent", triggers: [], rule: "Le retour." }, "2")).not.toBeNull();
  });

  it("deletes the skills of a member who leaves the archives", async () => {
    await createSkill(db, { name: "Tom", kind: "permanent", triggers: [], rule: "Une consigne de Tom." }, "1");
    await forgetMember(db, "1");
    expect((await activeSkills(db)).some((s) => s.authorId === "1")).toBe(false);
  });

  it("counts, lists and undoes actions", async () => {
    const since = new Date(Date.now() - 60_000);
    const base = { tool: "renameChannel", tier: "controlled" as const, params: { name: "x" }, requestedBy: "2", sourceMessageId: "m" };
    const done = await logAction(db, { ...base, status: "done", previousValue: { name: "old" } });
    await logAction(db, { ...base, status: "refused", refusalReason: "limite" });
    expect(await countActions(db, "renameChannel", since)).toBe(1);
    expect(await countActions(db, "pinMessage", since)).toBe(0);
    expect((await recentControlledActions(db)).map((a) => a.id)).toEqual([done]);

    expect(await markUndone(db, done, "2")).toBe(true);
    expect(await markUndone(db, done, "2")).toBe(false);
    expect(await countActions(db, "renameChannel", since)).toBe(1);
    await reopenAction(db, done);
    expect((await getAction(db, done))?.status).toBe("done");
  });

  it("confirms a pending action only once", async () => {
    const id = await logAction(db, { tool: "setRole", tier: "controlled", params: { role: "Gamer" }, status: "pending", requestedBy: "2", sourceMessageId: "m" });
    expect(await countActions(db, "setRole", new Date(Date.now() - 60_000))).toBe(0);
    expect((await claimPending(db, id))?.params).toEqual({ role: "Gamer" });
    expect(await claimPending(db, id)).toBeUndefined();
    await finishAction(db, id, { status: "done", previousValue: { had: false } });
    expect(await getAction(db, id)).toMatchObject({ status: "done", previousValue: { had: false } });
  });
});
