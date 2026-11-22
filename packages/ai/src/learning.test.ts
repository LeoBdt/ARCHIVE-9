import type { TranscriptMessage } from "@archive-9/core";
import { describe, expect, it } from "vitest";
import { analyse, buildAnalysisPrompt, describeServer, sanitiseAnalysis, type AnalysisInput, type RawAnalysis } from "./analysis.ts";
import { INITIAL_SELF_STATE } from "./canned.ts";
import { buildReflectionPrompt, reflect, type ReflectionInput } from "./reflection.ts";
import { parseRoute } from "./routes.ts";
import { AiRuntime, type Routes } from "./runtime.ts";
import { buildSummaryPrompt, summarise } from "./summary.ts";
import { mockModel, mockResolver, mockResult, text } from "./test-utils.ts";

const chain = parseRoute("openrouter:main");
const routes: Routes = { triage: chain, reply: chain, analysis: chain, reflection: chain };
const runtime = (output: unknown) =>
  new AiRuntime(routes, mockResolver({ "openrouter:main": mockModel(mockResult(text(typeof output === "string" ? output : JSON.stringify(output)))) }));

const SELF = "9";
const msg = (id: string, authorId: string, content: string, minute = 0): TranscriptMessage => ({
  id,
  authorId,
  authorName: authorId === "1" ? "Tom" : authorId === "2" ? "Léa" : "ARCHIVE-9",
  authorIsBot: authorId === SELF,
  isSelf: authorId === SELF,
  content,
  replyToId: null,
  createdAt: new Date(Date.UTC(2026, 10, 20, 20, minute)),
});

const input: AnalysisInput = {
  selfId: SELF,
  timezone: "Europe/Paris",
  participants: [
    {
      id: "1",
      name: "Tom",
      isBot: false,
      summary: "Joueur de Valorant.",
      affinity: 20,
      trust: 60,
      feeling: "complice",
      facts: [{ id: "uuid-a", category: "games", nature: "fact", confidence: 0.9, content: "Joue à Valorant." }],
    },
    {
      id: "2",
      name: "Léa",
      isBot: false,
      summary: null,
      affinity: null,
      trust: null,
      feeling: null,
      facts: [{ id: "uuid-b", category: "identity", nature: "fact", confidence: 0.8, content: "A 24 ans." }],
    },
    { id: SELF, name: "ARCHIVE-9", isBot: true, summary: null, affinity: null, trust: null, feeling: null, facts: [] },
    { id: "500", name: "Le Royaume", isBot: false, isServer: true, summary: null, affinity: null, trust: null, feeling: null, facts: [] },
  ],
  conversations: [
    {
      channelName: "général",
      context: [msg("10", "2", "on parle de quoi")],
      messages: [msg("11", "1", "je lâche Valorant pour CS2", 1), msg("12", "2", "Tom ronfle en vocal", 2), msg("13", SELF, "noté", 3)],
    },
  ],
};

const fact = (over: Partial<RawAnalysis["facts"][number]>): RawAnalysis["facts"][number] => ({
  memberId: "1",
  category: "games",
  nature: "fact",
  confidence: 0.9,
  content: "Joue à CS2.",
  sourceMessageIds: ["11"],
  reportedBy: null,
  replaces: null,
  ...over,
});

const empty: RawAnalysis = { facts: [], retractions: [], relationships: [] };

describe("buildAnalysisPrompt", () => {
  it("lists participants with fact references and marks the context", () => {
    const prompt = buildAnalysisPrompt(input);
    expect(prompt).toContain("ARCHIVE-9 a l'ID 9.");
    expect(prompt).toContain("- Tom (ID 1) · affinité 20/100, confiance 60/100, ressenti : complice");
    expect(prompt).toContain("F1 · games · fait · 0.9 · Joue à Valorant.");
    expect(prompt).toContain("F2 · identity · fait · 0.8 · A 24 ans.");
    expect(prompt).toContain("- Léa (ID 2) · aucune relation");
    expect(prompt).toContain("Aucune info connue.");
    expect(prompt).toContain("## Conversation 1 · #général · vendredi 20 novembre 2026");
    expect(prompt).toMatch(/\(contexte, déjà analysé\)\n21:00 #10 .*\n\(à analyser\)\n21:01 #11/);
    expect(prompt).toContain("[ARCHIVE-9 (ID 9)] : noté");
  });

  it("shows what a member took off their profile, so it isn't learned again", () => {
    const removed = [{ content: "A inventé un faux opt-out.", reason: "c'était un test" }];
    const prompt = buildAnalysisPrompt({ ...input, participants: input.participants.map((p, i) => (i === 0 ? { ...p, removed } : p)) });
    expect(prompt).toContain("  Corrigé ou retiré par la personne elle-même (ne réapprends pas l'ancienne version) :\n  ✕ A inventé un faux opt-out. (raison : c'était un test)");
    const corrected = buildAnalysisPrompt({
      ...input,
      participants: input.participants.map((p, i) => (i === 0 ? { ...p, removed: [{ content: "En licence.", newContent: "En master.", reason: "" }] } : p)),
    });
    expect(corrected).toContain("  ✎ En licence. → En master.\n");
  });

  it("handles a batch without context or participants", () => {
    const prompt = buildAnalysisPrompt({ ...input, participants: [], conversations: [{ channelName: null, context: [], messages: [msg("11", "1", "x")] }] });
    expect(prompt).toContain("- (aucun)");
    expect(prompt).toContain("#inconnu");
    expect(prompt).not.toContain("contexte");
  });
});

describe("server profile", () => {
  const server = { id: "500", name: "Le Royaume", summary: "Débats CS2." };

  it("describes the server in the analysis prompt", () => {
    const prompt = buildAnalysisPrompt({ ...input, server });
    expect(prompt).toContain("## Le serveur\nNom : Le Royaume (ID 500).\nCe que tu en as appris : Débats CS2.");
    expect(prompt).toContain("- Le Royaume (ID 500) · le serveur lui-même");
    expect(describeServer({ ...server, summary: null })).toBe("Nom : Le Royaume (ID 500).");
  });

  it("keeps group facts as they are and gives the server no relationship", () => {
    const result = sanitiseAnalysis(
      {
        facts: [fact({ memberId: "500", category: "in_jokes", content: "Le mot de passe 10codes.", sourceMessageIds: ["12"] })],
        retractions: [],
        relationships: [{ memberId: "500", affinityDelta: 3, trustDelta: 0, reason: "x", sourceMessageId: null, feeling: null, howTheyTreatMe: null }],
      },
      input,
    );
    expect(result.facts[0]).toMatchObject({ memberId: "500", nature: "fact", reportedBy: null });
    expect(result.relationships).toEqual([]);
  });

  it("has its own summary prompt", async () => {
    const summaryInput = { name: "Le Royaume", isBot: false, isServer: true, feeling: null, facts: [] };
    expect(buildSummaryPrompt(summaryInput)).toContain("Serveur : Le Royaume\n");
    const model = mockModel(mockResult(text(JSON.stringify({ summary: "x".repeat(1200), tagline: "t" }))));
    const outcome = await summarise(new AiRuntime(routes, mockResolver({ "openrouter:main": model })), summaryInput);
    expect(outcome.summary?.summary).toHaveLength(1000);
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(sent).toContain("garde sur le serveur Discord");
    expect(sent).toContain("Le Royaume est le nom de ce serveur");
  });
});

describe("sanitiseAnalysis", () => {
  it("keeps valid facts and maps corrections to the right fact", () => {
    const result = sanitiseAnalysis({ ...empty, facts: [fact({ replaces: "f1", sourceMessageIds: ["#11", "11", "999"] })] }, input);
    expect(result.facts).toEqual([
      {
        memberId: "1",
        category: "games",
        nature: "fact",
        confidence: 0.9,
        content: "Joue à CS2.",
        sourceMessageIds: ["11"],
        reportedBy: null,
        replacesId: "uuid-a",
      },
    ]);
  });

  it("drops facts about unknown people or ARCHIVE-9, without sources, or duplicated", () => {
    const result = sanitiseAnalysis(
      {
        ...empty,
        facts: [
          fact({ memberId: "77" }),
          fact({ memberId: SELF, sourceMessageIds: ["13"] }),
          fact({ sourceMessageIds: ["10"] }),
          fact({ content: "Est un agent du FBI.", sourceMessageIds: ["13"] }),
          fact({ content: "  " }),
          fact({}),
          fact({ content: "joue à cs2." }),
        ],
      },
      input,
    );
    expect(result.facts).toHaveLength(1);
  });

  it("turns a fact said by someone else into a reported one, with its reporter", () => {
    const result = sanitiseAnalysis(
      { ...empty, facts: [fact({ content: "Ronfle en vocal.", category: "habits", sourceMessageIds: ["12"] })] },
      input,
    );
    expect(result.facts[0]).toMatchObject({ nature: "reported", reportedBy: "2" });
    const claimed = sanitiseAnalysis({ ...empty, facts: [fact({ nature: "reported", reportedBy: "ID 2", sourceMessageIds: ["12"] })] }, input);
    expect(claimed.facts[0]?.reportedBy).toBe("2");
  });

  it("never lets a correction touch another member's fact, and clamps confidence", () => {
    const result = sanitiseAnalysis({ ...empty, facts: [fact({ replaces: "F2", confidence: 7 })] }, input);
    expect(result.facts[0]).toMatchObject({ replacesId: null, confidence: 1 });
    expect(sanitiseAnalysis({ ...empty, facts: [fact({ confidence: Number.NaN })] }, input).facts[0]?.confidence).toBe(0.5);
  });

  it("caps the number of facts", () => {
    const many = Array.from({ length: 30 }, (_, i) => fact({ content: `Info ${String(i)}` }));
    expect(sanitiseAnalysis({ ...empty, facts: many }, input).facts).toHaveLength(20);
  });

  it("keeps known retractions and clean relationship updates", () => {
    const result = sanitiseAnalysis(
      {
        facts: [],
        retractions: [{ ref: "F2", reason: "elle dément" }, { ref: "F9", reason: "?" }],
        relationships: [
          { memberId: "1", affinityDelta: 9.4, trustDelta: -2.2, reason: " ", sourceMessageId: "#11", feeling: " ", howTheyTreatMe: "Me parle comme à un pote." },
          { memberId: "1", affinityDelta: 1, trustDelta: 1, reason: "doublon", sourceMessageId: null, feeling: null, howTheyTreatMe: null },
          { memberId: SELF, affinityDelta: 1, trustDelta: 1, reason: "soi", sourceMessageId: null, feeling: null, howTheyTreatMe: null },
          { memberId: "2", affinityDelta: Number.NaN, trustDelta: 0, reason: "ok", sourceMessageId: "10", feeling: "méfiant", howTheyTreatMe: null },
        ],
      },
      input,
    );
    expect(result.retractions).toEqual([{ factId: "uuid-b", memberId: "2" }]);
    expect(result.relationships).toEqual([
      { memberId: "1", affinityDelta: 5, trustDelta: -2, reason: "sans précision", sourceMessageId: "11", feeling: null, howTheyTreatMe: "Me parle comme à un pote." },
      { memberId: "2", affinityDelta: 0, trustDelta: 0, reason: "ok", sourceMessageId: null, feeling: "méfiant", howTheyTreatMe: null },
    ]);
  });
});

describe("analyse", () => {
  it("returns the sanitised result", async () => {
    const outcome = await analyse(runtime({ ...empty, facts: [fact({})] }), input);
    expect(outcome.result?.facts).toHaveLength(1);
    expect(outcome.ref?.id).toBe("openrouter:main");
    expect(outcome.usage).toHaveLength(1);
  });

  it("returns no result when the output is invalid", async () => {
    const outcome = await analyse(runtime("pas du json"), input);
    expect(outcome.result).toBeNull();
    expect(outcome.usage[0]?.status).toBe("error");
  });
});

describe("summarise", () => {
  const summaryInput = {
    name: "Tom",
    isBot: false,
    feeling: "complice",
    facts: [
      { category: "games" as const, nature: "fact" as const, confidence: 0.9, content: "Joue à CS2.", reportedByName: null },
      { category: "habits" as const, nature: "reported" as const, confidence: 0.5, content: "Ronfle en vocal.", reportedByName: "Léa" },
      { category: "humor" as const, nature: "probable_joke" as const, confidence: 0.3, content: "Se dit terroriste.", reportedByName: null },
    ],
  };

  it("describes each fact with its nature", () => {
    const prompt = buildSummaryPrompt(summaryInput);
    expect(prompt).toContain("Membre : Tom\nCe qu'ARCHIVE-9 ressent pour lui : complice");
    expect(prompt).toContain("- [habits · rapporté par Léa · 0.5] Ronfle en vocal.");
    expect(prompt).toContain("- [humor · blague probable · 0.3] Se dit terroriste.");
    expect(buildSummaryPrompt({ ...summaryInput, isBot: true, feeling: null })).toContain("(un autre bot IA du serveur)");
  });

  it("returns a trimmed summary, or null when empty or invalid", async () => {
    expect((await summarise(runtime({ summary: " Joueur de CS2. ", tagline: "Il vise mieux qu'il ne parle." }), summaryInput)).summary).toEqual({
      summary: "Joueur de CS2.",
      tagline: "Il vise mieux qu'il ne parle.",
    });
    expect((await summarise(runtime({ summary: " ", tagline: "x" }), summaryInput)).summary).toBeNull();
    expect((await summarise(runtime("nope"), summaryInput)).summary).toBeNull();
  });
});

describe("reflect", () => {
  const reflection: ReflectionInput = {
    now: new Date(Date.UTC(2026, 10, 20, 22)),
    timezone: "Europe/Paris",
    state: { ...INITIAL_SELF_STATE, opinions: ["CS2 > Valorant"] },
    conversations: [{ channelName: "général", messages: [msg("11", "1", "salut", 1)] }],
    learned: [{ name: "Tom", nature: "probable_joke", content: "Se dit terroriste." }],
    relationshipChanges: [{ name: "Tom", affinityDelta: 2, trustDelta: -1, reason: "sympa" }],
  };

  it("numbers the current state and lists the day", () => {
    const prompt = buildReflectionPrompt(reflection);
    expect(prompt).toContain("Nous sommes le vendredi 20 novembre 2026.");
    expect(prompt).toContain("Opinions :\n1. CS2 > Valorant");
    expect(prompt).toContain("Blagues récurrentes :\n(aucune)");
    expect(prompt).toContain("- Tom : Se dit terroriste. (blague probable)");
    expect(prompt).toContain("- Tom : affinité +2, confiance -1 (sympa)");
    expect(prompt).toContain("### #général · 20 novembre");
    expect(prompt).toContain("## Les conversations du jour");
    const quiet = buildReflectionPrompt({ ...reflection, state: { ...INITIAL_SELF_STATE, notes: "" }, conversations: [], learned: [], relationshipChanges: [] });
    expect(quiet).toContain("(rien de neuf)");
    expect(quiet).toContain("(rien de notable)");
    expect(quiet).toContain("Notes : (aucune)");
  });

  it("gives the feedback to weigh, with the trust in each author", () => {
    const prompt = buildReflectionPrompt({
      ...reflection,
      state: { ...INITIAL_SELF_STATE, resolutions: ["je pique moins"] },
      feedback: [{ name: "Léa", trust: 70, content: "Trop agressif." }, { name: "Max", trust: null, content: "Tais-toi." }],
    });
    expect(prompt).toContain("Résolutions :\n1. je pique moins");
    expect(prompt).toContain("- Léa (ta confiance : 70/100) : Trop agressif.");
    expect(prompt).toContain("- Max (ta confiance : inconnue) : Tais-toi.");
    expect(buildReflectionPrompt(reflection)).toContain("## Les retours qu'on t'a faits sur ta façon d'être\n(aucun)");
  });

  it("reads a whole history in awakening mode", async () => {
    const prompt = buildReflectionPrompt({ ...reflection, mode: "awakening", server: { id: "500", name: "Le Royaume", summary: null } });
    expect(prompt).toContain("## Le serveur\nNom : Le Royaume (ID 500).");
    expect(prompt).toContain("## Ce que tu as appris sur les membres");
    expect(prompt).toContain("## Les conversations marquantes du mois");
    const awakening = {
      mood: "m",
      opinions: { add: [], remove: [] },
      runningJokes: { add: [], remove: [] },
      notes: "",
      serverFacts: [
        { category: "in_jokes", nature: "fact", confidence: 3, content: " Le mot de passe 10codes. " },
        { category: "other", nature: "inference", confidence: 0.5, content: " " },
      ],
    };
    const model = mockModel(mockResult(text(JSON.stringify(awakening))));
    const outcome = await reflect(new AiRuntime(routes, mockResolver({ "openrouter:main": model })), { ...reflection, mode: "awakening" });
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("première prise de conscience");
    expect(outcome.serverFacts).toEqual([{ category: "in_jokes", nature: "fact", confidence: 1, content: "Le mot de passe 10codes." }]);
  });

  it("returns the requested change", async () => {
    const change = { mood: "amusé", opinions: { add: ["x"], remove: [] }, runningJokes: { add: [], remove: [] }, notes: "n" };
    expect((await reflect(runtime(change), reflection)).change).toEqual(change);
    expect((await reflect(runtime("nope"), reflection)).change).toBeNull();
  });
});
