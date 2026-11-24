import { formatTranscript } from "@archive-9/core";
import { memberContexts, recentMessages } from "@archive-9/db";
import { tool } from "ai";
import { PermissionFlagsBits, type GuildBasedChannel } from "discord.js";
import { z } from "zod";
import { homeGuild, refused, requesterMember, type ToolContext } from "./context.ts";

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
      description: "Cherche un membre par son nom, pseudo ou ancien pseudo, et donne son ID et le résumé de son dossier.",
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
  };
}
