import type { AiRuntime, UsageRecord } from "@archive-9/ai";
import type { Database, DirectoryMember } from "@archive-9/db";
import { PermissionFlagsBits, type Guild, type GuildMember, type Message, type SendableChannels } from "discord.js";
import type { SendState } from "../discord/send-tools.ts";
import type { Logger } from "../logger.ts";
import type { SettingsStore } from "../settings.ts";

/** Everything a reply's tools may touch, bound to one target message. */
export interface ToolContext {
  db: Database;
  ai: AiRuntime;
  log: Logger;
  settings: SettingsStore;
  target: Message;
  channel: SendableChannels;
  send: SendState;
  selfId: string;
  /** The server ARCHIVE-9 lives on: actions only ever happen there. */
  guildId: string;
  /** Where bots may do anything; actions that stay inside it need no confirmation. */
  agentsCategoryId: string | null;
  /** Someone spoke to ARCHIVE-9 (mention, name, reply, DM). */
  addressed: boolean;
  timezone: string;
  names: ReadonlyMap<string, string>;
  directory: ReadonlyMap<string, DirectoryMember>;
  findMembers: (query: string, limit?: number) => string[];
  saveUsage: (usage: UsageRecord[], detail: string) => Promise<void>;
}

export type ToolResult = Record<string, unknown>;

export const refused = (reason: string): ToolResult => ({ ok: false, refused: reason });

/** The home server, also reachable from a DM. */
export function homeGuild(ctx: ToolContext): Guild | null {
  return ctx.target.client.guilds.cache.get(ctx.guildId) ?? null;
}

/** The requester as a server member, even when they wrote in DM. */
export async function requesterMember(ctx: ToolContext): Promise<GuildMember | null> {
  if (ctx.target.guildId === ctx.guildId && ctx.target.member) return ctx.target.member;
  const guild = homeGuild(ctx);
  return guild ? guild.members.fetch(ctx.target.author.id).catch(() => null) : null;
}

export function isAdmin(member: GuildMember): boolean {
  return member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "erreur inconnue";
}
