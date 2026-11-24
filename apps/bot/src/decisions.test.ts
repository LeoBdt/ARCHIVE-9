import { describe, expect, it } from "vitest";
import { describeRun } from "./pipeline.ts";

describe("describeRun", () => {
  it("tells what it had in mind, what it did and what it sent", () => {
    const details = describeRun(
      {
        reasoningText: "Elle demande une correction. ",
        steps: [
          { toolCalls: [{ toolName: "myFacts", input: {} }], toolResults: [{ toolName: "myFacts", output: { ok: true } }] },
          { toolCalls: [{ toolName: "sendReply", input: { content: "C'est fait." } }] },
        ],
      },
      {
        participants: [{ id: "1", name: "Léa", isBot: false, summary: null, affinity: 38, trust: 80, feeling: "curieuse", introduced: true, preferences: ["Vouvoie-moi."] }],
        authorId: "1",
        skills: ["Donut"],
        resolutions: ["je pique moins"],
        mentionNote: null,
        fallback: null,
        freeOnly: false,
      },
    );
    expect(details).toMatchObject({
      context: ["Léa : affinité 38, confiance 80, « curieuse »", "Ses préférences : Vouvoie-moi.", "Skills appliquées : Donut", "Mes résolutions : je pique moins"],
      reasoning: "Elle demande une correction.",
      steps: [
        { tool: "myFacts", summary: '{"ok":true}' },
        { tool: "sendReply", summary: "message envoyé" },
      ],
      sent: "C'est fait.",
    });
  });
});
