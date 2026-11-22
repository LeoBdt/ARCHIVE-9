import { forbiddenReason } from "@archive-9/core";
import { addFeedback, addPreference, FEEDBACK_PER_DAY, listPreferences, PREFERENCES_PER_MEMBER, removePreference } from "@archive-9/db";
import { tool } from "ai";
import { z } from "zod";
import { refused, type ToolContext } from "./context.ts";

/**
 * Feedback is about ARCHIVE-9 itself, for everyone; preferences are about one member, asked
 * by that member only. Skills (another file) are behaviours for the whole server.
 */
export function createFeedbackTools(ctx: ToolContext) {
  const owner = ctx.target.author.id;
  const allowed = () => ctx.addressed && !ctx.target.author.bot;

  return {
    noteFeedback: tool({
      description:
        "Note un retour sur ta façon d'être en général ou une logique que tu dois avoir (« tu es trop agressif avec les gens », « réfléchis avant de répondre aux questions techniques »). Tu en tiens compte tout de suite, et ta réflexion du soir décide de ce que tu changes durablement.",
      inputSchema: z.object({ content: z.string().min(5).max(300).describe("le retour, reformulé en une phrase, avec ses mots") }),
      execute: async ({ content }) => {
        if (!allowed()) return refused("seulement quand un membre te le dit");
        const saved = await addFeedback(ctx.db, owner, content.trim(), ctx.target.id);
        if (!saved) return refused(`déjà ${String(FEEDBACK_PER_DAY)} retours de sa part aujourd'hui`);
        ctx.log.info({ authorId: owner }, "feedback noted");
        return { ok: true, note: "Noté. Tu en tiens compte dès maintenant ; ce soir, tu décideras ce que tu changes pour de bon." };
      },
    }),

    myPreferences: tool({
      description: "Liste les préférences de la personne qui te parle (comment elle veut être traitée), avec une référence P1, P2…",
      inputSchema: z.object({}),
      execute: async () => {
        if (!allowed()) return refused("seulement quand la personne te le demande");
        const prefs = await listPreferences(ctx.db, owner);
        return { ok: true, preferences: prefs.map((p, i) => ({ ref: `P${String(i + 1)}`, content: p.content })) };
      },
    }),

    setMyPreference: tool({
      description:
        "Enregistre comment la personne qui te parle veut être traitée, elle seulement (« vouvoie-moi », « tu peux être plus piquant avec moi »). Tu l'appliqueras dès qu'elle sera dans une conversation.",
      inputSchema: z.object({ content: z.string().min(3).max(200).describe("la préférence, en une phrase courte") }),
      execute: async ({ content }) => {
        if (!allowed()) return refused("seulement quand la personne te le demande");
        const text = content.trim().replace(/\s+/g, " ");
        const forbidden = forbiddenReason(text);
        if (forbidden) return refused(forbidden);
        if (!(await addPreference(ctx.db, owner, text))) return refused(`déjà ${String(PREFERENCES_PER_MEMBER)} préférences, ou celle-ci existe déjà`);
        return { ok: true, saved: text };
      },
    }),

    forgetMyPreference: tool({
      description: "Retire une préférence de la personne qui te parle. Appelle myPreferences d'abord pour avoir la référence.",
      inputSchema: z.object({ ref: z.string().describe("référence donnée par myPreferences (P1, P2…)") }),
      execute: async ({ ref }) => {
        if (!allowed()) return refused("seulement quand la personne te le demande");
        const prefs = await listPreferences(ctx.db, owner);
        const pref = prefs[Number(/^P(\d+)$/i.exec(ref.trim())?.[1] ?? 0) - 1];
        if (!pref) return refused("cette référence n'existe pas : appelle myPreferences");
        await removePreference(ctx.db, owner, pref.id);
        return { ok: true, removed: pref.content };
      },
    }),
  };
}
