import { isTrivialContent } from "./content.ts";

export interface IncomingMessage {
  content: string;
  isDm: boolean;
  isFromSelf: boolean;
  authorIsBot: boolean;
  authorIsKnownAiBot: boolean;
  mentionsSelf: boolean;
  /** A strong name such as "ARCHIVE-9" appears in the message. */
  namesSelf: boolean;
  /** A weak name such as "archive", which is also a common word, appears in the message. */
  softNamesSelf: boolean;
  repliesToSelf: boolean;
  /** Same person ARCHIVE-9 just answered, with nobody else speaking in between. */
  continuesExchange: boolean;
}

export interface IngressContext {
  paused: boolean;
  authorOptedOut: boolean;
  channelListened: boolean;
  /** 0 means ARCHIVE-9 never speaks unprompted. */
  spontaneity: number;
  /** ARCHIVE-9 spoke in this channel moments ago, so a follow-up may be meant for it. */
  inActiveConversation: boolean;
  /**
   * The AGENTS category, where bots may do anything. Elsewhere on the server, only an
   * explicit @mention counts (a reply that pings it is one; a reply without the ping is not).
   */
  inAgents: boolean;
}

export type IgnoreReason =
  | "self"
  | "paused"
  | "opted_out"
  | "not_listened"
  | "foreign_bot"
  | "outside_agents"
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
  if (!msg.isDm && !ctx.inAgents) {
    return !fromBot && msg.mentionsSelf ? { action: "reply", fromBot } : { action: "ignore", reason: "outside_agents" };
  }
  const addressed = msg.isDm || msg.mentionsSelf || msg.namesSelf || msg.repliesToSelf || msg.continuesExchange;
  if (addressed) return { action: "reply", fromBot };

  if (isTrivialContent(msg.content)) return { action: "ignore", reason: "trivial" };
  if (ctx.spontaneity === 0 && !ctx.inActiveConversation && !msg.softNamesSelf) {
    return { action: "ignore", reason: "observer_mode" };
  }
  return { action: "triage", fromBot };
}
