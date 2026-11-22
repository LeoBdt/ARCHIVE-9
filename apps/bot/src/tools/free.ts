import { formatTranscript } from "@archive-9/core";
import { logAction, memberContexts, recentMessages } from "@archive-9/db";
import { tool } from "ai";
import { ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration, type GuildBasedChannel } from "discord.js";
import { z } from "zod";
import { errorText, homeGuild, refused, requesterMember, type ToolContext } from "./context.ts";

const MAX_READ = 30;

/** Finds a server channel from an ID, a `<#ID>` tag, `#name` or a plain name. */
export function findChannel(channels: Iterable<GuildBasedChannel>, query: string): GuildBasedChannel | null {
  const raw = query.trim();
  const id = /^<#(\d+)>$/.exec(raw)?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);
  const name = raw.replace(/^#/, "").toLowerCase();
  for (const channel of channels) {
    if (id ? channel.id === id : channel.name.toLowerCase() === name) return channel;
  }
  return null;
}

export function createFreeTools(ctx: ToolContext) {
  const log = (tool: string, params: Record<string, unknown>) =>
    logAction(ctx.db, { tool, tier: "free", params, status: "done", requestedBy: ctx.target.author.id, sourceMessageId: ctx.target.id }).catch((err: unknown) => {
      ctx.log.warn({ err }, "could not log action");
    });

  return {
    readChannel: tool({
      description: "Relit les derniers messages archivés d'un autre salon du serveur (nom ou ID). Utile quand on parle de ce qui s'est dit ailleurs.",
      inputSchema: z.object({
        channel: z.string().min(1).describe("nom du salon (#général), ou son ID"),
        limit: z.number().int().min(1).max(MAX_READ).default(15),
      }),
      execute: async ({ channel: query, limit }) => {
        const guild = homeGuild(ctx);
        if (!guild) return refused("serveur introuvable");
        const channel = findChannel(guild.channels.cache.values(), query);
        if (!channel?.isTextBased()) return refused("salon introuvable");
        if (!ctx.settings.isListened(channel.id, channel.parentId)) return refused("je n'archive pas ce salon");
        const member = await requesterMember(ctx);
        const canRead = member && channel.permissionsFor(member).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
        if (!canRead) return refused("la personne qui demande n'a pas accès à ce salon");
        // Never repeat a private channel somewhere its members aren't the only readers.
        const isPublic = channel.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.ViewChannel);
        if (!isPublic && ctx.target.guildId !== null && ctx.target.channelId !== channel.id) {
          return refused("salon privé : demande-le-moi en message privé");
        }
        const history = await recentMessages(ctx.db, channel.id, ctx.selfId, limit);
        if (history.length === 0) return { ok: true, channel: channel.name, messages: "(rien d'archivé)" };
        const transcript = formatTranscript(history, { timeZone: ctx.timezone, names: ctx.names, maxContentLength: 300 });
        return { ok: true, channel: channel.name, messages: `<donnees>\n${transcript}\n</donnees>` };
      },
    }),

    findMember: tool({
      description: "Cherche un membre par son nom, pseudo ou ancien pseudo, et donne son ID et sa fiche.",
      inputSchema: z.object({ query: z.string().min(2).max(100) }),
      execute: async ({ query }) => {
        const tagged = /^<@!?(\d+)>$/.exec(query.trim())?.[1] ?? query.trim();
        const ids = ctx.directory.has(tagged) ? [tagged] : ctx.findMembers(query, 5);
        if (ids.length === 0) return { ok: true, found: [] };
        const contexts = await memberContexts(ctx.db, ids);
        return {
          ok: true,
          found: ids.map((id) => {
            const member = ctx.directory.get(id);
            return { id, name: member?.name ?? id, isBot: member?.isBot ?? false, summary: contexts.get(id)?.summary ?? null };
          }),
        };
      },
    }),

    createThread: tool({
      description: "Ouvre un fil de discussion sur le message cible, avec un premier message optionnel dedans. Pour un sujet qui mérite son propre espace.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        message: z.string().min(1).max(2000).optional().describe("premier message dans le fil"),
      }),
      execute: async ({ name, message }) => {
        const { target } = ctx;
        if (target.channel.type !== ChannelType.GuildText && target.channel.type !== ChannelType.GuildAnnouncement) {
          return refused("pas de fil possible ici");
        }
        if (target.hasThread) return refused("ce message a déjà un fil");
        try {
          const thread = await target.startThread({ name, autoArchiveDuration: ThreadAutoArchiveDuration.OneDay });
          if (message) ctx.send.sentMessageIds.push((await thread.send(message)).id);
          await log("createThread", { name, threadId: thread.id });
          return { ok: true, threadId: thread.id };
        } catch (error) {
          return { ok: false, error: errorText(error) };
        }
      },
    }),

    createPoll: tool({
      description: "Lance un sondage Discord dans le salon. Compte comme un message envoyé.",
      inputSchema: z.object({
        question: z.string().min(1).max(300),
        answers: z.array(z.string().min(1).max(55)).min(2).max(10),
        hours: z.number().int().min(1).max(168).default(24).describe("durée en heures"),
        multiple: z.boolean().default(false).describe("plusieurs réponses possibles"),
      }),
      execute: async ({ question, answers, hours, multiple }) => {
        try {
          const sent = await ctx.channel.send({
            poll: { question: { text: question }, answers: answers.map((text) => ({ text })), duration: hours, allowMultiselect: multiple },
          });
          ctx.send.sentMessageIds.push(sent.id);
          await log("createPoll", { question, answers, hours });
          return { ok: true, sent: true };
        } catch (error) {
          return { ok: false, error: errorText(error) };
        }
      },
    }),
  };
}
