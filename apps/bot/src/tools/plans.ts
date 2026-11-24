import { channelSlug, checkMemberTarget, checkRoleTarget, type ControlledAction } from "@archive-9/core";
import { optedOutIds, type Database } from "@archive-9/db";
import { ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration, type Guild, type GuildBasedChannel, type GuildMember, type Role } from "discord.js";

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

export interface PlanDeps {
  db: Database;
  selfId: string;
  agentsCategoryId: string | null;
}

/**
 * A checked action, ready to run once the requester confirms. Every action waits for that
 * click, AGENTS included: the server's rule for bots.
 */
export interface Plan {
  /** One line in French, for the confirmation message and the journal. */
  summary: string;
  /** The exact Discord API requests it will send, shown before confirming. */
  requests: string[];
  run: (reason: string) => Promise<{ result: Record<string, unknown>; previous: Record<string, unknown> }>;
}

const json = (body: Record<string, unknown>) => JSON.stringify(body);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function isOwner(member: GuildMember): boolean {
  return member.id === member.guild.ownerId;
}

/** Discord's own rule: you only act on someone whose top role is below yours. */
function above(requester: GuildMember, target: GuildMember): boolean {
  return requester.id === target.id || isOwner(requester) || requester.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

async function memberTarget(deps: PlanDeps, guild: Guild, requester: GuildMember, id: string): Promise<GuildMember | string> {
  const member = await guild.members.fetch(id).catch(() => null);
  if (!member) return "membre introuvable";
  const problem = checkMemberTarget({
    isSelf: id === deps.selfId,
    isOwner: isOwner(member),
    isBot: member.user.bot,
    optedOut: (await optedOutIds(deps.db, [id])).has(id),
    manageable: member.manageable,
    requesterAbove: above(requester, member),
  });
  return problem ?? member;
}

function roleTarget(guild: Guild, requester: GuildMember, query: string): Role | string {
  const raw = query.trim();
  const id = /^<@&(\d+)>$/.exec(raw)?.[1] ?? raw;
  const name = raw.replace(/^@/, "").toLowerCase();
  const role = guild.roles.cache.get(id) ?? guild.roles.cache.find((r) => r.name.toLowerCase() === name);
  if (!role) return "rôle introuvable";
  const problem = checkRoleTarget({
    isEveryone: role.id === guild.id,
    managed: role.managed,
    hasSensitivePermission: SENSITIVE_PERMISSIONS.some((p) => role.permissions.has(p)),
    belowMine: role.position < (guild.members.me?.roles.highest.position ?? 0),
    belowRequester: isOwner(requester) || role.position < requester.roles.highest.position,
  });
  return problem ?? role;
}

function lacks(requester: GuildMember, permission: bigint, channel?: GuildBasedChannel): boolean {
  const permissions = channel ? channel.permissionsFor(requester) : requester.permissions;
  return !permissions.has(permission);
}

/**
 * Checks an action against the server's rules and the requester's own rights, and returns
 * what to run, or why not. Called again on confirmation, so nothing stale gets through.
 */
export async function planAction(deps: PlanDeps, guild: Guild, requester: GuildMember, tool: ControlledAction, params: Record<string, unknown>): Promise<Plan | string> {
  switch (tool) {
    case "createChannel": {
      const parentId = text(params.parentId) || null;
      if (lacks(requester, PermissionFlagsBits.ManageChannels)) return "il faut le droit « Gérer les salons »";
      const voice = params.voice === true;
      const name = voice ? text(params.name).slice(0, 100) : channelSlug(text(params.name));
      if (!name) return "nom de salon vide";
      return {
        summary: `créer le salon ${voice ? "vocal " : ""}#${name}`,
        requests: [`POST /guilds/${guild.id}/channels ${json({ name, type: voice ? 2 : 0, parent_id: parentId })}`],
        run: async (reason) => {
          const channel = await guild.channels.create({ name, type: voice ? ChannelType.GuildVoice : ChannelType.GuildText, parent: parentId, reason });
          return { result: { channel: `<#${channel.id}>` }, previous: { channelId: channel.id } };
        },
      };
    }

    case "renameChannel": {
      const channel = guild.channels.cache.get(text(params.channelId));
      if (!channel) return "salon introuvable";
      if (channel.type === ChannelType.GuildCategory) return "pas les catégories";
      if (lacks(requester, PermissionFlagsBits.ManageChannels, channel)) return "il faut le droit « Gérer les salons » sur ce salon";
      const before = channel.name;
      const after = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement ? channelSlug(text(params.name)) : text(params.name);
      if (!after) return "nom de salon vide";
      return {
        summary: `renommer #${before} en #${after}`,
        requests: [`PATCH /channels/${channel.id} ${json({ name: after })}`],
        run: async (reason) => {
          await channel.setName(after, reason);
          return { result: { before, after }, previous: { channelId: channel.id, name: before } };
        },
      };
    }

    case "renameMember": {
      const member = await memberTarget(deps, guild, requester, text(params.memberId));
      if (typeof member === "string") return member;
      const self = member.id === requester.id;
      if (self ? lacks(requester, PermissionFlagsBits.ChangeNickname) : lacks(requester, PermissionFlagsBits.ManageNicknames)) {
        return self ? "il faut le droit « Changer de pseudo »" : "il faut le droit « Gérer les pseudos »";
      }
      const nickname = text(params.nickname).trim().slice(0, 32) || null;
      const before = member.nickname;
      return {
        summary: `changer le pseudo de ${member.displayName} en « ${nickname ?? member.user.username} »`,
        requests: [`PATCH /guilds/${guild.id}/members/${member.id} ${json({ nick: nickname })}`],
        run: async (reason) => {
          await member.setNickname(nickname, reason);
          return { result: { before: before ?? member.user.username, after: nickname ?? member.user.username }, previous: { memberId: member.id, nickname: before } };
        },
      };
    }

    case "setRole": {
      if (lacks(requester, PermissionFlagsBits.ManageRoles)) return "il faut le droit « Gérer les rôles »";
      const member = await memberTarget(deps, guild, requester, text(params.memberId));
      if (typeof member === "string") return member;
      const role = roleTarget(guild, requester, text(params.role));
      if (typeof role === "string") return role;
      const give = params.give === true;
      const had = member.roles.cache.has(role.id);
      if (had === give) return give ? "il a déjà ce rôle" : "il n'a pas ce rôle";
      return {
        summary: `${give ? "donner" : "retirer"} le rôle ${role.name} à ${member.displayName}`,
        requests: [`${give ? "PUT" : "DELETE"} /guilds/${guild.id}/members/${member.id}/roles/${role.id}`],
        run: async (reason) => {
          await (give ? member.roles.add(role, reason) : member.roles.remove(role, reason));
          return { result: { role: role.name, given: give }, previous: { memberId: member.id, roleId: role.id, had } };
        },
      };
    }

    case "pinMessage": {
      const channel = guild.channels.cache.get(text(params.channelId));
      if (!channel?.isTextBased()) return "salon introuvable";
      if (lacks(requester, PermissionFlagsBits.PinMessages, channel) && lacks(requester, PermissionFlagsBits.ManageMessages, channel)) {
        return "il faut le droit « Épingler des messages » dans ce salon";
      }
      const message = await channel.messages.fetch(text(params.messageId)).catch(() => null);
      if (!message) return "message introuvable";
      if (message.pinned) return "déjà épinglé";
      return {
        summary: `épingler un message dans #${channel.name}`,
        requests: [`PUT /channels/${channel.id}/pins/${message.id}`],
        run: async (reason) => {
          await message.pin(reason);
          return { result: { pinned: true }, previous: { channelId: channel.id, messageId: message.id } };
        },
      };
    }

    case "createThread": {
      const channel = guild.channels.cache.get(text(params.channelId));
      if (channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return "pas de fil possible ici";
      if (lacks(requester, PermissionFlagsBits.CreatePublicThreads, channel)) return "il faut le droit « Créer des fils publics » dans ce salon";
      const message = await channel.messages.fetch(text(params.messageId)).catch(() => null);
      if (!message) return "message introuvable";
      if (message.hasThread) return "ce message a déjà un fil";
      const name = text(params.name).trim().slice(0, 100);
      if (!name) return "nom de fil vide";
      const first = text(params.message).trim().slice(0, 2000);
      return {
        summary: `ouvrir le fil « ${name} » dans #${channel.name}`,
        requests: [
          `POST /channels/${channel.id}/messages/${message.id}/threads ${json({ name, auto_archive_duration: 1440 })}`,
          ...(first ? [`POST /channels/{fil}/messages ${json({ content: first.length > 80 ? `${first.slice(0, 79)}…` : first })}`] : []),
        ],
        run: async (reason) => {
          const thread = await message.startThread({ name, autoArchiveDuration: ThreadAutoArchiveDuration.OneDay, reason });
          if (first) await thread.send({ content: first, allowedMentions: { parse: [] } });
          return { result: { thread: `<#${thread.id}>` }, previous: { threadId: thread.id } };
        },
      };
    }

    case "createPoll": {
      const channel = guild.channels.cache.get(text(params.channelId));
      if (!channel?.isTextBased() || !channel.isSendable()) return "salon introuvable";
      if (lacks(requester, PermissionFlagsBits.SendPolls, channel)) return "il faut le droit « Créer des sondages » dans ce salon";
      const question = text(params.question).trim().slice(0, 300);
      const answers = (Array.isArray(params.answers) ? params.answers : []).map(text).map((a) => a.trim().slice(0, 55)).filter(Boolean).slice(0, 10);
      if (!question || answers.length < 2) return "il faut une question et au moins deux réponses";
      const hours = Math.max(1, Math.min(168, Math.round(Number(params.hours) || 24)));
      const multiple = params.multiple === true;
      return {
        summary: `lancer le sondage « ${question} » dans #${channel.name}`,
        requests: [`POST /channels/${channel.id}/messages ${json({ poll: { question: { text: question }, answers: answers.map((a) => ({ poll_media: { text: a } })), duration: hours, allow_multiselect: multiple } })}`],
        run: async () => {
          const sent = await channel.send({ poll: { question: { text: question }, answers: answers.map((a) => ({ text: a })), duration: hours, allowMultiselect: multiple } });
          return { result: { sent: true }, previous: { channelId: channel.id, messageId: sent.id } };
        },
      };
    }
  }
}
