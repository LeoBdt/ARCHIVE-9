import type { Channel } from "discord.js";

/** The category holding a channel, seen through a thread when needed. */
export function categoryOf(channel: Channel): string | null {
  if (channel.isDMBased()) return null;
  if (channel.isThread()) return channel.parent?.parentId ?? null;
  return channel.parentId;
}

/** True for a channel of the AGENTS category, or a thread in one of them. */
export function isInAgents(channel: Channel, agentsCategoryId: string | null): boolean {
  return agentsCategoryId !== null && (channel.id === agentsCategoryId || categoryOf(channel) === agentsCategoryId);
}
