import { describe, expect, it } from "vitest";
import { decideIngress, type IncomingMessage, type IngressContext } from "./ingress.ts";

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  content: "on se fait une partie ce soir ?",
  isDm: false,
  isFromSelf: false,
  authorIsBot: false,
  authorIsKnownAiBot: false,
  mentionsSelf: false,
  namesSelf: false,
  softNamesSelf: false,
  repliesToSelf: false,
  continuesExchange: false,
  ...over,
});

const ctx = (over: Partial<IngressContext> = {}): IngressContext => ({
  paused: false,
  authorOptedOut: false,
  channelListened: true,
  spontaneity: 1,
  inActiveConversation: false,
  inAgents: true,
  ...over,
});

describe("decideIngress", () => {
  it.each([
    ["self", msg({ isFromSelf: true, mentionsSelf: true }), ctx()],
    ["paused", msg({ mentionsSelf: true }), ctx({ paused: true })],
    ["opted_out", msg({ mentionsSelf: true }), ctx({ authorOptedOut: true })],
    ["not_listened", msg({ mentionsSelf: true }), ctx({ channelListened: false })],
    ["foreign_bot", msg({ authorIsBot: true, mentionsSelf: true }), ctx()],
    ["trivial", msg({ content: "😂😂" }), ctx()],
    ["observer_mode", msg(), ctx({ spontaneity: 0 })],
  ] as const)("ignores: %s", (reason, m, c) => {
    expect(decideIngress(m, c)).toEqual({ action: "ignore", reason });
  });

  it.each([
    ["mention", msg({ mentionsSelf: true })],
    ["strong name", msg({ namesSelf: true })],
    ["reply", msg({ repliesToSelf: true })],
    ["DM", msg({ isDm: true })],
    ["direct follow-up", msg({ continuesExchange: true, content: "je suis ému" })],
    ["mention with emoji only", msg({ mentionsSelf: true, content: "<@1> 👋" })],
  ])("always replies when addressed: %s", (_label, m) => {
    expect(decideIngress(m, ctx({ spontaneity: 0 }))).toEqual({ action: "reply", fromBot: false });
  });

  it("answers DMs even though they are not a listened channel", () => {
    expect(decideIngress(msg({ isDm: true }), ctx({ channelListened: false }))).toEqual({ action: "reply", fromBot: false });
  });

  it("sends weak names to triage, even in observer mode", () => {
    expect(decideIngress(msg({ softNamesSelf: true, content: "bah archive" }), ctx({ spontaneity: 0 }))).toEqual({ action: "triage", fromBot: false });
  });

  it("triages follow-ups in observer mode while a conversation is active", () => {
    expect(decideIngress(msg(), ctx({ spontaneity: 0, inActiveConversation: true }))).toEqual({ action: "triage", fromBot: false });
  });

  it("sends other messages to triage when spontaneity is on", () => {
    expect(decideIngress(msg(), ctx())).toEqual({ action: "triage", fromBot: false });
  });

  describe("outside the AGENTS category", () => {
    const outside = (over: Partial<IngressContext> = {}) => ctx({ inAgents: false, spontaneity: 3, ...over });

    it.each([
      ["mention", msg({ mentionsSelf: true })],
      ["reply", msg({ repliesToSelf: true })],
    ])("replies to a %s from a human", (_label, m) => {
      expect(decideIngress(m, outside())).toEqual({ action: "reply", fromBot: false });
    });

    it.each([
      ["strong name", msg({ namesSelf: true })],
      ["weak name", msg({ softNamesSelf: true })],
      ["direct follow-up", msg({ continuesExchange: true })],
      ["ordinary message", msg()],
      ["bot mention", msg({ authorIsBot: true, authorIsKnownAiBot: true, mentionsSelf: true })],
    ])("stays out of it: %s", (_label, m) => {
      expect(decideIngress(m, outside({ inActiveConversation: true }))).toEqual({ action: "ignore", reason: "outside_agents" });
    });

    it("still answers DMs", () => {
      expect(decideIngress(msg({ isDm: true }), outside({ channelListened: false }))).toEqual({ action: "reply", fromBot: false });
    });
  });

  it("flags known AI bots so the loop guard can run", () => {
    const fromAi = msg({ authorIsBot: true, authorIsKnownAiBot: true });
    expect(decideIngress(fromAi, ctx())).toEqual({ action: "triage", fromBot: true });
    expect(decideIngress({ ...fromAi, namesSelf: true }, ctx())).toEqual({ action: "reply", fromBot: true });
  });
});
