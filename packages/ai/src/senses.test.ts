import { describe, expect, it } from "vitest";
import { INITIAL_SELF_STATE } from "./canned.ts";
import { embedTexts } from "./embeddings.ts";
import { reflect } from "./reflection.ts";
import { parseRoute } from "./routes.ts";
import { AiRuntime, type Routes } from "./runtime.ts";
import { mockModel, mockResolver, mockResult, text } from "./test-utils.ts";
import { seeImage } from "./vision.ts";

const route = parseRoute("openrouter:main");
const routes: Routes = { triage: route, reply: route, analysis: route, reflection: route, vision: route, embedding: route, voice: route };
const runtime = (answer: string) => new AiRuntime(routes, mockResolver({ "openrouter:main": mockModel(mockResult(text(answer))) }));
const config = { apiKey: "k", model: "baai/bge-m3", baseUrl: "https://example.test" };
const reply = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("embeddings", () => {
  it("returns the vectors in order with their cost", async () => {
    const fetchImpl = reply(200, { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 7, cost: 0.0001 }, provider: "DeepInfra" });
    const outcome = await embedTexts(config, ["a", "b"], fetchImpl);
    expect(outcome.vectors).toEqual([[1], [2]]);
    expect(outcome.usage).toMatchObject({ task: "embedding", inputTokens: 7, costUsd: 0.0001, upstreamProvider: "DeepInfra", status: "ok" });
  });

  it("reports refusals, rate limits, short answers and network errors", async () => {
    expect((await embedTexts(config, ["a"], reply(400, { error: { message: "bad model" } }))).usage).toMatchObject({ status: "error", error: "bad model" });
    expect((await embedTexts(config, ["a"], reply(429, {}))).usage).toMatchObject({ status: "rate_limited", error: "HTTP 429" });
    expect((await embedTexts(config, ["a", "b"], reply(200, { data: [{ index: 0, embedding: [1] }] }))).vectors).toBeNull();
    const down = await embedTexts(config, ["a"], () => Promise.reject(new Error("offline")));
    expect(down).toMatchObject({ vectors: null, usage: { status: "error", error: "offline" } });
  });
});

describe("vision", () => {
  const frame = { data: new Uint8Array([1, 2, 3]), mediaType: "image/png" };

  it("describes an image in one line", async () => {
    const outcome = await seeImage(runtime("Un chat\n  sur un clavier."), { frames: [frame], kind: "image", caption: "regardez", name: "chat.png" });
    expect(outcome.description).toBe("Un chat sur un clavier.");
    expect(outcome.ref?.id).toBe("openrouter:main");
  });

  it("gives nothing when no model could look", async () => {
    expect((await seeImage(runtime("   "), { frames: [frame, frame, frame], kind: "gif", caption: "" })).description).toBeNull();
  });
});

describe("the evening notebook", () => {
  const input = {
    now: new Date("2026-11-20T21:00:00Z"),
    timezone: "Europe/Paris",
    state: INITIAL_SELF_STATE,
    conversations: [],
    learned: [],
    relationshipChanges: [],
    difficulties: [{ name: "Léa", asked: "mets un rappel", what: "aucun outil" }],
    skills: [{ name: "top 3", rule: "Réponds en top 3." }],
    notebook: [{ kind: "wish" as const, content: "Retenir les anniversaires.", status: "declined" as const, answer: "pas pour l'instant" }],
  };
  const base = { mood: "calme", opinions: { add: [], remove: [] }, runningJokes: { add: [], remove: [] }, notes: "rien" };

  it("keeps a skill of its own and up to three notes for the owner", async () => {
    const answer = {
      ...base,
      newSkill: { name: " Classements ", kind: "triggered", triggers: [" classement ", ""], rule: "Réponds en top 3.", why: "demandé deux fois" },
      toCreator: [
        { kind: "gap", content: "Je n'ai pas de rappels.", why: "Léa en voulait un" },
        { kind: "wish", content: " ", why: "vide" },
        { kind: "wish", content: "a", why: "" },
        { kind: "gap", content: "b", why: "" },
        { kind: "gap", content: "c", why: "" },
      ],
    };
    const outcome = await reflect(runtime(JSON.stringify(answer)), input);
    expect(outcome.newSkill).toEqual({ name: "Classements", kind: "triggered", triggers: ["classement"], rule: "Réponds en top 3.", why: "demandé deux fois" });
    expect(outcome.notes).toHaveLength(3);
    expect(outcome.notes[0]).toEqual({ kind: "gap", content: "Je n'ai pas de rappels.", why: "Léa en voulait un" });
  });

  it("gives no skill nor note when it asks for none, and none at midday", async () => {
    const none = await reflect(runtime(JSON.stringify({ ...base, newSkill: null })), input);
    expect(none).toMatchObject({ newSkill: null, notes: [] });
    const midday = await reflect(runtime(JSON.stringify({ mood: "calme", runningJokes: { add: [], remove: [] }, notes: "x" })), { ...input, mode: "midday" });
    expect(midday).toMatchObject({ newSkill: null, notes: [] });
  });
});
