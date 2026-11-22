import { tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { INITIAL_SELF_STATE, OFFLINE_LINES, pickOfflineLine } from "./canned.ts";
import { SERVER_DESCRIPTION } from "./prompts/server.ts";
import { buildReplyPrompt, REPLY_SYSTEM, reply, type ReplyInput } from "./reply.ts";
import { parseRoute } from "./routes.ts";
import { AiRuntime, type Routes } from "./runtime.ts";
import { mockModel, mockResolver, mockResult, text, toolCall } from "./test-utils.ts";
import { buildTriagePrompt, triage } from "./triage.ts";

const chain = parseRoute("groq:main");
const routes: Routes = { triage: chain, reply: chain, analysis: chain, reflection: chain };

describe("triage", () => {
  const input = { transcript: "[Tom (ID 1)] : archive t'en penses quoi ?", channelName: "général", conversationNote: "" };

  it("returns the validated decision", async () => {
    const decision = { addressed: true, interest: 10, reason: "on lui pose une question", toolPacks: ["discord-messages"] };
    const ai = new AiRuntime(routes, mockResolver({ "groq:main": mockModel(mockResult(text(JSON.stringify(decision)))) }));
    const outcome = await triage(ai, input);
    expect(outcome.decision).toEqual(decision);
    expect(outcome.ref?.id).toBe("groq:main");
  });

  it("trims an overly long reason instead of failing", async () => {
    const decision = { addressed: false, interest: 3, reason: "x".repeat(500), toolPacks: [] };
    const ai = new AiRuntime(routes, mockResolver({ "groq:main": mockModel(mockResult(text(JSON.stringify(decision)))) }));
    expect((await triage(ai, input)).decision?.reason).toHaveLength(300);
  });

  it("returns no decision instead of throwing when the output is unusable", async () => {
    for (const content of [text("pas du json"), text(JSON.stringify({ addressed: "maybe" })), []]) {
      const ai = new AiRuntime(routes, mockResolver({ "groq:main": mockModel(mockResult(content)) }));
      const outcome = await triage(ai, input);
      expect(outcome.decision).toBeNull();
      expect(outcome.usage[0]?.status).toBe("error");
    }
  });

  it("puts the computed note first and the transcript in the data zone", () => {
    const prompt = buildTriagePrompt({ transcript: "LIGNE", channelName: "jeux", conversationNote: "Il a parlé il y a 12 s." });
    expect(prompt).toContain("Salon : jeux. Il a parlé il y a 12 s.");
    expect(prompt).toMatch(/<donnees>\nLIGNE\n<\/donnees>/);
    expect(buildTriagePrompt({ transcript: "", channelName: null, conversationNote: "" })).toContain("inconnu");
  });
});

const baseInput: ReplyInput = {
  now: new Date("2026-01-01T20:00:00Z"),
  timezone: "Europe/Paris",
  channelName: "général",
  isDm: false,
  addressed: true,
  targetId: "42",
  targetAuthorId: "1",
  triageReason: null,
  transcript: "[Tom (ID 1)] : salut archive",
  participants: [{ id: "1", name: "Tom", isBot: false, summary: null, affinity: null, trust: null, feeling: null, introduced: false }],
  selfState: INITIAL_SELF_STATE,
};

describe("buildReplyPrompt", () => {
  it("asks for an introduction on first contact", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt).toContain("premier échange");
    expect(prompt).toContain("aucune relation enregistrée");
    expect(prompt).toContain("message cible est #42");
  });

  it("describes known relations, summaries, state and ambient mode", () => {
    const prompt = buildReplyPrompt({
      ...baseInput,
      addressed: false,
      triageReason: "question au groupe",
      isDm: true,
      participants: [{ id: "1", name: "Tom", isBot: true, summary: "aime le café", affinity: 40, trust: 70, feeling: "complice", introduced: true }],
      selfState: { mood: "grognon", opinions: ["le café est surcoté"], runningJokes: ["Tom et ses retards"], notes: "rien" },
    });
    expect(prompt).not.toContain("premier échange");
    expect(prompt).toContain("affinité 40/100, confiance 70/100, ressenti : complice");
    expect(prompt).toContain("Fiche : aime le café");
    expect(prompt).toContain("(question au groupe)");
    expect(prompt).toContain("tu interviens de toi-même");
    expect(prompt).toContain("message privé");
    expect(prompt).toContain("Blagues récurrentes : Tom et ses retards");
    expect(prompt).not.toContain("récemment ailleurs");
  });

  it("adds the short memory of the target author", () => {
    const said = { id: "7", authorId: "1", authorName: "Tom", authorIsBot: false, isSelf: false, content: "j'ai stage lundi", replyToId: null, createdAt: new Date("2026-01-01T18:00:00Z") };
    const prompt = buildReplyPrompt({ ...baseInput, elsewhere: [{ where: "en message privé", messages: [said] }, { where: "#jeux", messages: [] }] });
    expect(prompt).toContain("## Ce que Tom t'a dit récemment ailleurs");
    expect(prompt).toMatch(/### en message privé\n<donnees>\n19:00 #7 \[Tom \(ID 1\)\] : j'ai stage lundi\n<\/donnees>/);
    expect(prompt).not.toContain("#jeux");
  });

  it("tells it about the server", () => {
    const prompt = buildReplyPrompt({ ...baseInput, server: { id: "5", name: "Le Royaume", summary: "Débats CS2." } });
    expect(prompt).toContain("## Le serveur\nNom : Le Royaume (ID 5).\nCe que tu en as appris : Débats CS2.");
    expect(buildReplyPrompt(baseInput)).not.toContain("## Le serveur");
  });
});

describe("reply", () => {
  it("stops as soon as a send tool is called", async () => {
    const send = vi.fn(() => Promise.resolve({ sent: true }));
    const tools = { sendReply: tool({ description: "send", inputSchema: z.object({ content: z.string() }), execute: send }) };
    const model = mockModel(mockResult(toolCall("sendReply", { content: "yo" })));
    const ai = new AiRuntime(routes, mockResolver({ "groq:main": model }));
    const factory = vi.fn(() => tools);
    const outcome = await reply(ai, baseInput, factory);
    expect(outcome.ok).toBe(true);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ id: "groq:main" }), false);
    expect(send).toHaveBeenCalledOnce();
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});

describe("persona", () => {
  it("knows the server and keeps the sarcasm occasional", () => {
    expect(REPLY_SYSTEM).toContain(SERVER_DESCRIPTION);
    expect(REPLY_SYSTEM).toContain("Une pique en fin de message");
  });
});

describe("canned lines", () => {
  it("picks a line from the list", () => {
    expect(pickOfflineLine(() => 0)).toBe(OFFLINE_LINES[0]);
    expect(pickOfflineLine(() => 0.999)).toBe(OFFLINE_LINES.at(-1));
    expect(OFFLINE_LINES).toContain(pickOfflineLine());
  });
});
