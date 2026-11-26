import { tool } from "ai";
import { z } from "zod";
import { errorText, refused, requesterMember, type ToolContext } from "./context.ts";

/** Joining the voice channel where the requester is, and leaving it. Only when a member asks. */
export function createVoiceTools(ctx: ToolContext) {
  const allowed = () => ctx.addressed && !ctx.target.author.bot;
  return {
    joinVoice: tool({
      description: "Rejoint le salon vocal où se trouve la personne qui te le demande, pour parler avec eux à voix haute. Seulement quand on te le demande.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!allowed()) return refused("seulement quand un membre te le demande");
        if (!ctx.voice) return refused("je n'ai pas de voix sur ce serveur pour l'instant");
        const member = await requesterMember(ctx);
        const channel = member?.voice.channel;
        if (!channel) return refused("la personne n'est dans aucun salon vocal : il faut qu'elle y soit d'abord");
        if (!channel.joinable) return refused("je n'ai pas le droit d'entrer dans ce salon");
        try {
          await ctx.voice.join(channel);
          return { ok: true, joined: channel.name, note: "Tu y es : tu viens de dire bonjour à voix haute. Réponds ici en une phrase courte." };
        } catch (error) {
          ctx.log.warn({ err: error }, "voice join failed");
          return refused(`impossible de me connecter au vocal (${errorText(error)})`);
        }
      },
    }),
    leaveVoice: tool({
      description: "Quitte le salon vocal où tu es, quand on te le demande.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!allowed()) return refused("seulement quand un membre te le demande");
        if (!(await ctx.voice?.leave("Je vous laisse. À plus."))) return refused("je ne suis dans aucun salon vocal");
        return { ok: true };
      },
    }),
  };
}
