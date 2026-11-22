import { isTrivialContent } from "./content.ts";

export interface IncomingMessage {
  content: string;
  isDm: boolean;
  isFromSelf: boolean;
  authorIsBot: boolean;
  authorIsKnownAiBot: boolean;
  mentionsSelf: boolean;
  namesSelf: boolean;
  repliesToSelf: boolean;
  /** Same person ARCHIVE-9 just answered, with nobody else speaking in between. */
  continuesExchange: boolean;
}

export interface IngressContext {
  paused: boolean;
  authorOptedOut: boolean;
  channelListened: boolean;
  ambientReplies: boolean;
  /** ARCHIVE-9 spoke in this channel moments ago, so a follow-up may be meant for it. */
  inActiveConversation: boolean;
}

export type IgnoreReason =
  | "self"
  | "paused"
  | "opted_out"
  | "not_listened"
  | "foreign_bot"
  | "trivial"
  | "observer_mode";

export type IngressDecision =
  | { action: "ignore"; reason: IgnoreReason }
  | { action: "reply"; fromBot: boolean }
  | { action: "triage"; fromBot: boolean };

/** First, AI-free stage: decides whether a message is answered, triaged, or dropped. */
export function decideIngress(msg: IncomingMessage, ctx: IngressContext): IngressDecision {
  if (msg.isFromSelf) return { action: "ignore", reason: "self" };
  if (ctx.paused) return { action: "ignore", reason: "paused" };
  if (ctx.authorOptedOut) return { action: "ignore", reason: "opted_out" };
  if (!msg.isDm && !ctx.channelListened) return { action: "ignore", reason: "not_listened" };
  if (msg.authorIsBot && !msg.authorIsKnownAiBot) return { action: "ignore", reason: "foreign_bot" };

  const fromBot = msg.authorIsBot;
  const addressed = msg.isDm || msg.mentionsSelf || msg.namesSelf || msg.repliesToSelf || msg.continuesExchange;
  if (addressed) return { action: "reply", fromBot };

  if (isTrivialContent(msg.content)) return { action: "ignore", reason: "trivial" };
  if (!ctx.ambientReplies && !ctx.inActiveConversation) return { action: "ignore", reason: "observer_mode" };
  return { action: "triage", fromBot };
}
