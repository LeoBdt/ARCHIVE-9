import { describe, expect, it } from "vitest";
import { INITIAL_SELF_STATE } from "./canned.ts";
import { reflect } from "./reflection.ts";
import { parseRoute } from "./routes.ts";
import { AiRuntime, type Routes } from "./runtime.ts";
import { answerMindComment, buildCorrectionPrompt, buildSkillRequestPrompt, planCorrection, planSkill, writeChangelog } from "./site-tasks.ts";
import { buildDossierTidyPrompt, checkDossierTidy, planDossierTidy } from "./tidy.ts";
import { mockModel, mockResolver, mockResult, text } from "./test-utils.ts";

const route = parseRoute("openrouter:main");
const routes: Routes = { triage: route, reply: route, analysis: route, reflection: route, vision: route, embedding: route, voice: route };
const runtime = (output: unknown) => new AiRuntime(routes, mockResolver({ "openrouter:main": mockModel(mockResult(text(JSON.stringify(output)))) }));
const broken = () => new AiRuntime(routes, mockResolver({ "openrouter:main": mockModel(mockResult(text("pas du JSON"))) }));

const correction = {
  name: "Dave",
  editorName: "Léo",
  byOwner: false,
  before: "Joue à LoL en ranked.",
  after: "Ne joue plus à LoL, il est passé sur Valorant.",
  reason: "il a arrêté",
  facts: [
    { ref: "F1", category: "games", content: "Joue en ranked le soir." },
    { ref: "F2", category: "tastes", content: "Déteste la coriandre." },
  ],
  categories: [
    { key: "games", label: "Jeux" },
    { key: "other", label: "Divers" },
  ],
};

describe("a correction from the site", () => {
  it("says who changed what, as data", () => {
    const prompt = buildCorrectionPrompt(correction);
    expect(prompt).toContain("Léo (admin), sur le dossier de Dave");
    expect(prompt).toContain("Avant : Joue à LoL en ranked.\nAprès : Ne joue plus");
    expect(prompt).toContain("F1 · games · Joue en ranked le soir.");
    expect(buildCorrectionPrompt({ ...correction, after: null, byOwner: true })).toContain("Retiré : Joue à LoL");
  });

  it("keeps only known fragments and drawers", async () => {
    const outcome = await planCorrection(
      runtime({ retract: [{ ref: "f1", why: "venait de LoL" }, { ref: "F9", why: "?" }], add: [{ category: "nope", content: "Joue à Valorant." }, { category: "games", content: "x" }], say: "Compris." }),
      correction,
    );
    expect(outcome.value).toEqual({ retract: [{ ref: "F1", why: "venait de LoL" }], add: [{ category: "other", content: "Joue à Valorant." }], say: "Compris." });
    expect((await planCorrection(broken(), correction)).value).toBeNull();
  });
});

describe("a skill taught from the site", () => {
  const input = { requesterName: "Léo", text: "Réagis avec 🌧️ quand on parle de pluie.", now: new Date("2026-11-24T14:00:00Z"), timezone: "Europe/Paris", channels: ["général", "météo"] };

  it("gives the channels and the current skill when editing", () => {
    expect(buildSkillRequestPrompt(input)).toContain("Salons : #général, #météo");
    const edit = buildSkillRequestPrompt({ ...input, current: { name: "pluie", kind: "triggered", triggers: ["pluie"], rule: "Réagis.", channel: "météo", member: null } });
    expect(edit).toContain("## La skill actuelle (modification)\nNom : pluie\nType : triggered (pluie)");
    expect(edit).toContain("Salon : #météo");
  });

  it("returns its plan", async () => {
    const plan = { accept: true, refusal: "", name: "pluie", kind: "triggered", triggers: ["pluie"], rule: "Réagis avec 🌧️.", until: null, channel: null, onlyRequester: false, understood: "Compris.", example: "« il pleut » → 🌧️" };
    expect((await planSkill(runtime(plan), input)).value).toMatchObject({ name: "pluie", kind: "triggered" });
  });
});

describe("a comment on its mind", () => {
  it("answers in a few sentences", async () => {
    const outcome = await answerMindComment(runtime({ say: "  Tu as raison à moitié.  " }), { authorName: "Léo", about: "blague : x", comment: "usée", state: INITIAL_SELF_STATE });
    expect(outcome.value).toBe("Tu as raison à moitié.");
    expect((await answerMindComment(broken(), { authorName: "Léo", about: "x", comment: "y", state: INITIAL_SELF_STATE })).value).toBeNull();
  });
});

describe("the changelog", () => {
  it("keeps lines tied to real commits", async () => {
    const commits = [{ sha: "abcdef1234567", title: "feat(web): recherche", body: "- tri par date\n- tri par affinité" }];
    const outcome = await writeChangelog(runtime({ comment: "Plus de tris.", items: [{ text: "Tri par date.", sha: "abcdef1" }, { text: "Inventé.", sha: "0000000" }] }), { kind: "site", label: "1.1.0", commits });
    expect(outcome.value).toEqual({ comment: "Plus de tris.", items: [{ text: "Tri par date.", sha: "abcdef1" }] });
    expect((await writeChangelog(broken(), { kind: "site", label: "1.1.0", commits })).value).toBeNull();
  });
});

describe("tidying a dossier", () => {
  const day = new Date("2026-11-20T12:00:00Z");
  const fact = (rank: number, nature: "fact" | "probable_joke" = "fact", category = "other") => ({
    id: `id${String(rank)}`,
    rank,
    category,
    nature,
    confidence: 0.8,
    content: `fragment ${String(rank)}`,
    sources: 1,
    reportedByName: null,
    createdAt: day,
  });
  const input = {
    name: "Léa",
    isServer: false,
    summary: null,
    facts: [fact(1), fact(2), fact(3, "probable_joke"), fact(4), fact(5), fact(6), fact(7)],
    drawers: [
      { key: "games", label: "Jeux", personal: false, count: 0 },
      { key: "other", label: "Divers", personal: false, count: 7 },
    ],
    room: 1,
    lookalikes: [["id1", "id2"]] as [string, string][],
    timezone: "Europe/Paris",
  };

  it("lists the dossier with its ranks and the lookalike pairs", () => {
    const prompt = buildDossierTidyPrompt(input);
    expect(prompt).toContain("F001 ~ F002");
    expect(prompt).toContain("F007 · other · fait");
  });

  it("keeps one operation per fragment, known drawers and merges within one nature", () => {
    const checked = checkDossierTidy(
      {
        merges: [
          { keep: "F1", remove: ["F2"], content: null, why: "même chose" },
          { keep: "F4", remove: ["F3"], content: null, why: "une blague et un fait" },
        ],
        deletes: [{ ref: "F2", why: "déjà fusionné" }, { ref: "F9", why: "inconnu" }],
        rewrites: [{ ref: "F4", content: "mieux dit", why: "plus clair" }],
        moves: [{ ref: "F4", to: "games", why: "déjà réécrit" }, { ref: "F5", to: "nope", why: "x" }, { ref: "f005", to: "games", why: "un jeu" }],
        drawers: [{ label: "Sa moto", why: "trois fragments", refs: ["F5", "F6", "F7"] }],
      },
      input,
    );
    expect(checked.merges).toEqual([{ keepId: "id1", removeIds: ["id2"], content: null, why: "même chose" }]);
    expect(checked.deletes).toEqual([]);
    expect(checked.rewrites).toEqual([{ factId: "id4", content: "mieux dit", why: "plus clair" }]);
    expect(checked.drawers).toEqual([{ label: "Sa moto", why: "trois fragments", factIds: ["id5", "id6", "id7"] }]);
    expect(checked.moves).toEqual([]);
  });

  it("returns no plan when every model fails", async () => {
    expect((await planDossierTidy(broken(), input)).plan).toBeNull();
  });
});

describe("the midday reflection", () => {
  it("only touches the mood, the journal and the jokes, and picks a face", async () => {
    const outcome = await reflect(runtime({ mood: "calme", icon: "tired", runningJokes: { add: ["une"], remove: [] }, notes: "matinée tranquille" }), {
      mode: "midday",
      now: new Date(),
      timezone: "Europe/Paris",
      state: INITIAL_SELF_STATE,
      conversations: [],
      learned: [],
      relationshipChanges: [],
    });
    expect(outcome.change).toEqual({ mood: "calme", notes: "matinée tranquille", runningJokes: { add: ["une"], remove: [] }, opinions: { add: [], remove: [] } });
    expect(outcome.icon).toBe("tired");
  });

  it("keeps the evening's verdicts that point at real feedback", async () => {
    const outcome = await reflect(
      runtime({ mood: "m", opinions: { add: [], remove: [] }, runningJokes: { add: [], remove: [] }, notes: "n", verdicts: [{ n: 1, verdict: "adopted", why: "Trois personnes." }, { n: 5, verdict: "ignored", why: "?" }] }),
      { now: new Date(), timezone: "Europe/Paris", state: INITIAL_SELF_STATE, conversations: [], learned: [], relationshipChanges: [], feedback: [{ name: "Léa", trust: 70, content: "trop sec" }] },
    );
    expect(outcome.verdicts).toEqual([{ n: 1, verdict: "adopted", why: "Trois personnes." }]);
  });
});
