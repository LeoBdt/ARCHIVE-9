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
  repliesToSelf: false,
  continuesExchange: false,
  repliesToOther: false,
  ...over,
});

const ctx = (over: Partial<IngressContext> = {}): IngressContext => ({
  paused: false,
  authorOptedOut: false,
  channelListened: true,
  ambientReplies: true,
  inActiveConversation: false,
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
    ["addressed_elsewhere", msg({ repliesToOther: true }), ctx({ inActiveConversation: true })],
    ["observer_mode", msg(), ctx({ ambientReplies: false })],
  ] as const)("ignores: %s", (reason, m, c) => {
    expect(decideIngress(m, c)).toEqual({ action: "ignore", reason });
  });

  it.each([
    ["mention", msg({ mentionsSelf: true })],
    ["name", msg({ namesSelf: true })],
    ["reply", msg({ repliesToSelf: true })],
    ["DM", msg({ isDm: true })],
    ["direct follow-up", msg({ continuesExchange: true, content: "je suis ému" })],
    ["reply to someone else that names it", msg({ repliesToOther: true, namesSelf: true })],
    ["mention with emoji only", msg({ mentionsSelf: true, content: "<@1> 👋" })],
  ])("always replies when addressed: %s", (_label, m) => {
    expect(decideIngress(m, ctx({ ambientReplies: false }))).toEqual({ action: "reply", fromBot: false });
  });

  it("answers DMs even though they are not a listened channel", () => {
    expect(decideIngress(msg({ isDm: true }), ctx({ channelListened: false }))).toEqual({ action: "reply", fromBot: false });
  });

  it("triages follow-ups in observer mode while a conversation is active", () => {
    expect(decideIngress(msg(), ctx({ ambientReplies: false, inActiveConversation: true }))).toEqual({ action: "triage", fromBot: false });
  });

  it("sends ambient messages to triage", () => {
    expect(decideIngress(msg(), ctx())).toEqual({ action: "triage", fromBot: false });
  });

  it("flags known AI bots so the loop guard can run", () => {
    const fromAi = msg({ authorIsBot: true, authorIsKnownAiBot: true });
    expect(decideIngress(fromAi, ctx())).toEqual({ action: "triage", fromBot: true });
    expect(decideIngress({ ...fromAi, namesSelf: true }, ctx())).toEqual({ action: "reply", fromBot: true });
  });
});
