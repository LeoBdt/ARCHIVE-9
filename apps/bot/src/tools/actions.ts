import { checkRequester, CONFIRMATION_MS, CONTROLLED_PER_HOUR, type ControlledAction } from "@archive-9/core";
import { countActions, logAction } from "@archive-9/db";
import { tool } from "ai";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { z } from "zod";
import { categoryOf } from "../discord/zone.ts";
import { errorText, homeGuild, refused, type ToolContext } from "./context.ts";
import { findChannel } from "./free.ts";
import { planAction } from "./plans.ts";

const HOUR_MS = 60 * 60_000;

export async function overHourlyLimit(db: ToolContext["db"], tool: ControlledAction): Promise<boolean> {
  return (await countActions(db, tool, new Date(Date.now() - HOUR_MS))) >= CONTROLLED_PER_HOUR;
}

export const reasonFor = (username: string) => `Demandé par ${username} via ARCHIVE-9`;

/** The message under which the requester confirms: what, the exact requests, who may click. */
export function confirmationText(plan: { summary: string; requests: string[] }, requesterId: string): string {
  const minutes = String(CONFIRMATION_MS / 60_000);
  const head = `**Confirmation** · ${plan.summary} ?`;
  const foot = `-# Seul·e <@${requesterId}> peut valider, pendant ${minutes} min. Rien n'est fait avant.`;
  const room = 2000 - head.length - foot.length - 20;
  let lines = plan.requests.join("\n");
  if (lines.length > room) lines = `${lines.slice(0, room - 1)}…`;
  return `${head}\n\`\`\`http\n${lines}\n\`\`\`\n${foot}`;
}

export function confirmationButtons(actionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`confirm:${actionId}`).setLabel("Confirmer").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject:${actionId}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary),
  );
}

export function createActionTools(ctx: ToolContext) {
  const base = { tier: "controlled" as const, requestedBy: ctx.target.author.id, sourceMessageId: ctx.target.id };

  /**
   * Shared path of every controlled action: who asks, hourly limit, the checks of the plan,
   * then the full plan with a confirmation button. Nothing runs before the requester clicks.
   */
  async function request(tool: ControlledAction, params: Record<string, unknown>) {
    const log = (status: "done" | "refused" | "failed" | "pending", extra: { refusalReason?: string; previousValue?: Record<string, unknown> } = {}) =>
      logAction(ctx.db, { ...base, tool, params, status, ...extra });
    const refuse = async (reason: string) => {
      await log("refused", { refusalReason: reason }).catch((err: unknown) => {
        ctx.log.warn({ err }, "could not log action");
      });
      return refused(reason);
    };

    const guild = homeGuild(ctx);
    const denied = checkRequester({ addressed: ctx.addressed, isBot: ctx.target.author.bot, inGuild: ctx.target.guildId === ctx.guildId });
    const requester = ctx.target.member;
    if (denied || !guild || !requester) return refuse(denied ?? "serveur introuvable");
    if (await overHourlyLimit(ctx.db, tool)) return refuse(`déjà ${String(CONTROLLED_PER_HOUR)} actions de ce type dans l'heure`);

    try {
      const plan = await planAction({ db: ctx.db, selfId: ctx.selfId, agentsCategoryId: ctx.agentsCategoryId }, guild, requester, tool, params);
      if (typeof plan === "string") return await refuse(plan);
      const actionId = await log("pending");
      const sent = await ctx.target.reply({
        content: confirmationText(plan, ctx.target.author.id),
        components: [confirmationButtons(actionId)],
        allowedMentions: { parse: [] },
      });
      ctx.send.sentMessageIds.push(sent.id);
      return {
        ok: true,
        pending: true,
        note: "Le plan est affiché avec un bouton « Confirmer » : l'action se fera seulement quand la personne cliquera. Ne dis pas que c'est fait.",
      };
    } catch (error) {
      await log("failed", { refusalReason: errorText(error) }).catch(() => undefined);
      return { ok: false, error: errorText(error) };
    }
  }

  const channelId = (query: string | undefined) => {
    if (!query) return ctx.target.channelId;
    const guild = homeGuild(ctx);
    return (guild && findChannel(guild.channels.cache.values(), query)?.id) ?? query;
  };
  const onRequest = "Seulement si un membre te l'a explicitement demandé.";

  return {
    createChannel: tool({
      description: `Crée un salon dans la même catégorie que le salon actuel. ${onRequest}`,
      inputSchema: z.object({ name: z.string().min(1).max(100), voice: z.boolean().default(false).describe("salon vocal") }),
      execute: ({ name, voice }) => request("createChannel", { name, voice, parentId: categoryOf(ctx.target.channel) }),
    }),

    renameChannel: tool({
      description: `Renomme un salon (le salon actuel par défaut). ${onRequest}`,
      inputSchema: z.object({ name: z.string().min(1).max(100), channel: z.string().optional().describe("nom ou ID, sinon le salon actuel") }),
      execute: ({ name, channel }) => request("renameChannel", { name, channelId: channelId(channel) }),
    }),

    renameMember: tool({
      description: `Change le pseudo d'un membre sur le serveur. Pseudo vide pour le remettre à zéro. ${onRequest}`,
      inputSchema: z.object({ memberId: z.string().regex(/^\d+$/), nickname: z.string().max(32) }),
      execute: ({ memberId, nickname }) => request("renameMember", { memberId, nickname }),
    }),

    setRole: tool({
      description: `Donne ou retire un rôle simple à un membre. Les rôles avec des permissions sensibles sont refusés. ${onRequest}`,
      inputSchema: z.object({
        memberId: z.string().regex(/^\d+$/),
        role: z.string().min(1).describe("nom ou ID du rôle"),
        give: z.boolean().describe("true pour donner, false pour retirer"),
      }),
      execute: ({ memberId, role, give }) => request("setRole", { memberId, role, give }),
    }),

    createThread: tool({
      description: `Ouvre un fil de discussion sur le message cible, avec un premier message optionnel dedans. ${onRequest}`,
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        message: z.string().min(1).max(2000).optional().describe("premier message dans le fil"),
      }),
      execute: ({ name, message }) => request("createThread", { channelId: ctx.target.channelId, messageId: ctx.target.id, name, message: message ?? "" }),
    }),

    createPoll: tool({
      description: `Lance un sondage Discord dans le salon. ${onRequest}`,
      inputSchema: z.object({
        question: z.string().min(1).max(300),
        answers: z.array(z.string().min(1).max(55)).min(2).max(10),
        hours: z.number().int().min(1).max(168).default(24).describe("durée en heures"),
        multiple: z.boolean().default(false).describe("plusieurs réponses possibles"),
      }),
      execute: ({ question, answers, hours, multiple }) => request("createPoll", { channelId: ctx.target.channelId, question, answers, hours, multiple }),
    }),

    pinMessage: tool({
      description: `Épingle un message du salon actuel (le message cible par défaut). ${onRequest}`,
      inputSchema: z.object({ messageId: z.string().regex(/^\d+$/).optional() }),
      execute: ({ messageId }) => request("pinMessage", { channelId: ctx.target.channelId, messageId: messageId ?? ctx.target.id }),
    }),
  };
}
