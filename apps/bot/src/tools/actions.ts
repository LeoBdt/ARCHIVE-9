import {
  channelSlug,
  checkMemberTarget,
  checkRequester,
  checkRoleTarget,
  CONTROLLED_PER_HOUR,
  type ControlledAction,
} from "@archive-9/core";
import { countActions, logAction, optedOutIds } from "@archive-9/db";
import { tool } from "ai";
import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type Role } from "discord.js";
import { z } from "zod";
import { errorText, homeGuild, isAdmin, refused, type ToolContext, type ToolResult } from "./context.ts";
import { findChannel } from "./free.ts";

/** A role carrying any of these is never given or taken by ARCHIVE-9. */
export const SENSITIVE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

interface Done {
  result: ToolResult;
  /** What undo needs to put things back. */
  previous: Record<string, unknown>;
}

const HOUR_MS = 60 * 60_000;

export function createActionTools(ctx: ToolContext) {
  const base = { tier: "controlled" as const, requestedBy: ctx.target.author.id, sourceMessageId: ctx.target.id };

  /** Shared checks, rate limit and journal around every controlled action. */
  async function controlled(name: ControlledAction, params: Record<string, unknown>, run: (guild: Guild) => Promise<Done | string>) {
    const record = (status: "done" | "refused" | "failed", extra: { refusalReason?: string; previousValue?: Record<string, unknown> }) =>
      logAction(ctx.db, { ...base, tool: name, params, status, ...extra }).catch((err: unknown) => {
        ctx.log.warn({ err }, "could not log action");
      });
    const refuse = async (reason: string) => {
      await record("refused", { refusalReason: reason });
      return refused(reason);
    };

    const guild = homeGuild(ctx);
    const denied = checkRequester({ addressed: ctx.addressed, isBot: ctx.target.author.bot, inGuild: ctx.target.guildId === ctx.guildId });
    if (denied || !guild) return refuse(denied ?? "serveur introuvable");
    if ((await countActions(ctx.db, name, new Date(Date.now() - HOUR_MS))) >= CONTROLLED_PER_HOUR) {
      return refuse(`déjà ${String(CONTROLLED_PER_HOUR)} actions de ce type dans l'heure`);
    }
    try {
      const outcome = await run(guild);
      if (typeof outcome === "string") return await refuse(outcome);
      await record("done", { previousValue: outcome.previous });
      ctx.log.info({ tool: name, params, by: ctx.target.author.id }, "controlled action");
      return { ok: true, ...outcome.result };
    } catch (error) {
      await record("failed", { refusalReason: errorText(error) });
      return { ok: false, error: errorText(error) };
    }
  }

  async function memberTarget(guild: Guild, id: string): Promise<GuildMember | string> {
    const member = await guild.members.fetch(id).catch(() => null);
    if (!member) return "membre introuvable";
    const optedOut = (await optedOutIds(ctx.db, [id])).has(id);
    const problem = checkMemberTarget({
      isSelf: id === ctx.selfId,
      isOwner: id === guild.ownerId,
      isAdmin: isAdmin(member),
      isBot: member.user.bot,
      optedOut,
      manageable: member.manageable,
    });
    return problem ?? member;
  }

  function roleTarget(guild: Guild, query: string): Role | string {
    const raw = query.trim();
    const id = /^<@&(\d+)>$/.exec(raw)?.[1] ?? raw;
    const role = guild.roles.cache.get(id) ?? guild.roles.cache.find((r) => r.name.toLowerCase() === raw.replace(/^@/, "").toLowerCase());
    if (!role) return "rôle introuvable";
    const mine = guild.members.me?.roles.highest.position ?? 0;
    const problem = checkRoleTarget({
      isEveryone: role.id === guild.id,
      managed: role.managed,
      hasSensitivePermission: SENSITIVE_PERMISSIONS.some((p) => role.permissions.has(p)),
      belowMine: role.position < mine,
    });
    return problem ?? role;
  }

  const onRequest = "Seulement si un membre te l'a explicitement demandé.";

  return {
    createChannel: tool({
      description: `Crée un salon dans la même catégorie que le salon actuel. ${onRequest}`,
      inputSchema: z.object({ name: z.string().min(1).max(100), voice: z.boolean().default(false).describe("salon vocal") }),
      execute: ({ name, voice }) =>
        controlled("createChannel", { name, voice }, async (guild) => {
          const parent = "parentId" in ctx.target.channel ? ctx.target.channel.parentId : null;
          const channel = await guild.channels.create({
            name: voice ? name.slice(0, 100) : channelSlug(name),
            type: voice ? ChannelType.GuildVoice : ChannelType.GuildText,
            parent,
            reason: `Demandé par ${ctx.target.author.username} via ARCHIVE-9`,
          });
          return { result: { channel: `<#${channel.id}>` }, previous: { channelId: channel.id } };
        }),
    }),

    renameChannel: tool({
      description: `Renomme un salon (le salon actuel par défaut). ${onRequest}`,
      inputSchema: z.object({ name: z.string().min(1).max(100), channel: z.string().optional().describe("nom ou ID, sinon le salon actuel") }),
      execute: ({ name, channel: query }) =>
        controlled("renameChannel", { name, channel: query ?? null }, async (guild) => {
          const channel = query ? findChannel(guild.channels.cache.values(), query) : guild.channels.cache.get(ctx.target.channelId);
          if (!channel) return "salon introuvable";
          if (!channel.manageable) return "je n'ai pas le droit de modifier ce salon";
          const before = channel.name;
          const after = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement ? channelSlug(name) : name;
          await channel.setName(after, `Demandé par ${ctx.target.author.username} via ARCHIVE-9`);
          return { result: { before, after }, previous: { channelId: channel.id, name: before } };
        }),
    }),

    renameMember: tool({
      description: `Change le pseudo d'un membre sur le serveur. Pseudo vide pour le remettre à zéro. ${onRequest}`,
      inputSchema: z.object({ memberId: z.string().regex(/^\d+$/), nickname: z.string().max(32) }),
      execute: ({ memberId, nickname }) =>
        controlled("renameMember", { memberId, nickname }, async (guild) => {
          const member = await memberTarget(guild, memberId);
          if (typeof member === "string") return member;
          const before = member.nickname;
          await member.setNickname(nickname.trim() || null, `Demandé par ${ctx.target.author.username} via ARCHIVE-9`);
          return { result: { before: before ?? member.user.username, after: nickname.trim() || member.user.username }, previous: { memberId, nickname: before } };
        }),
    }),

    setRole: tool({
      description: `Donne ou retire un rôle simple à un membre. Les rôles avec des permissions sensibles sont refusés. ${onRequest}`,
      inputSchema: z.object({ memberId: z.string().regex(/^\d+$/), role: z.string().min(1).describe("nom ou ID du rôle"), give: z.boolean().describe("true pour donner, false pour retirer") }),
      execute: ({ memberId, role: query, give }) =>
        controlled("setRole", { memberId, role: query, give }, async (guild) => {
          const member = await memberTarget(guild, memberId);
          if (typeof member === "string") return member;
          const role = roleTarget(guild, query);
          if (typeof role === "string") return role;
          const had = member.roles.cache.has(role.id);
          if (had === give) return give ? "il a déjà ce rôle" : "il n'a pas ce rôle";
          const reason = `Demandé par ${ctx.target.author.username} via ARCHIVE-9`;
          await (give ? member.roles.add(role, reason) : member.roles.remove(role, reason));
          return { result: { role: role.name, given: give }, previous: { memberId, roleId: role.id, had } };
        }),
    }),

    pinMessage: tool({
      description: `Épingle un message du salon actuel (le message cible par défaut). ${onRequest}`,
      inputSchema: z.object({ messageId: z.string().regex(/^\d+$/).optional() }),
      execute: ({ messageId }) =>
        controlled("pinMessage", { messageId: messageId ?? ctx.target.id }, async () => {
          const message = messageId ? await ctx.target.channel.messages.fetch(messageId).catch(() => null) : ctx.target;
          if (!message) return "message introuvable";
          if (message.pinned) return "déjà épinglé";
          await message.pin(`Demandé par ${ctx.target.author.username} via ARCHIVE-9`);
          return { result: { pinned: true }, previous: { channelId: message.channelId, messageId: message.id } };
        }),
    }),
  };
}
