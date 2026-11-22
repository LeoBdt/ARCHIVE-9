import { tool } from "ai";
import type { Message, SendableChannels } from "discord.js";
import { z } from "zod";

const MAX_LENGTH = 2000;

export interface SendState {
  sentMessageIds: string[];
  reacted: boolean;
}

/**
 * Tools bound to one channel and one target message, so the model never picks where it
 * speaks. `suffix` is appended to the first message sent (the fallback tag).
 */
export function createSendTools(channel: SendableChannels, target: Message, state: SendState, suffix?: string) {
  const finalise = (content: string) => {
    const tail = state.sentMessageIds.length === 0 && suffix ? `\n${suffix}` : "";
    return `${content.trim().slice(0, MAX_LENGTH - tail.length)}${tail}`;
  };

  return {
    sendReply: tool({
      description: "Répond au message cible (réponse Discord). Moyen par défaut de parler.",
      inputSchema: z.object({ content: z.string().min(1).describe("texte du message, formatage Discord autorisé") }),
      execute: async ({ content }) => {
        const sent = await target.reply({ content: finalise(content) });
        state.sentMessageIds.push(sent.id);
        return { sent: true };
      },
    }),
    sendMessage: tool({
      description: "Envoie un message simple dans le salon, sans répondre à un message précis.",
      inputSchema: z.object({ content: z.string().min(1) }),
      execute: async ({ content }) => {
        const sent = await channel.send({ content: finalise(content) });
        state.sentMessageIds.push(sent.id);
        return { sent: true };
      },
    }),
    addReaction: tool({
      description: "Réagit au message cible avec un emoji unicode (ex : 😂). Ne compte pas comme une réponse.",
      inputSchema: z.object({ emoji: z.string().min(1).max(16) }),
      execute: async ({ emoji }) => {
        await target.react(emoji);
        state.reacted = true;
        return { reacted: true };
      },
    }),
  };
}
