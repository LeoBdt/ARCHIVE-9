import { checkOwnFactText, fragmentCode, parseFragmentNumber, parseFragmentRef } from "@archive-9/core";
import { correctOwnFact, dossierFacts, forgetOwnFacts } from "@archive-9/db";
import { tool } from "ai";
import { z } from "zod";
import { refused, type ToolContext } from "./context.ts";

const LISTED = 40;

/** Lets someone see and trim their own profile, never anyone else's. */
export function createProfileTools(ctx: ToolContext) {
  const owner = ctx.target.author.id;
  const allowed = () => ctx.addressed && !ctx.target.author.bot;
  const list = () => dossierFacts(ctx.db, owner);
  // « #K7QX3M » (its identifier) or « F012 » (its rank).
  const pick = <T extends { ref: string; rank: number }>(facts: T[], ref: string) => {
    const rank = ref.trim().startsWith("#") ? null : parseFragmentNumber(ref);
    const id = parseFragmentRef(ref);
    return rank !== null ? facts.find((f) => f.rank === rank) : facts.find((f) => f.ref === id);
  };

  return {
    myFacts: tool({
      description: "Liste les fragments du dossier de la personne qui te parle (la sienne seulement), avec leur rang (F001…) et leur identifiant (#K7QX3M).",
      inputSchema: z.object({}),
      execute: async () => {
        if (!allowed()) return refused("seulement quand la personne te le demande");
        const facts = await list();
        return { ok: true, count: facts.length, facts: facts.slice(0, LISTED * 3).map((f) => ({ rank: fragmentCode(f.rank), id: `#${f.ref}`, content: f.content, nature: f.nature })) };
      },
    }),

    forgetMyFacts: tool({
      description:
        "Retire des fragments du dossier de la personne qui te parle, quand elle te le demande. Appelle myFacts d'abord pour avoir les références. Il faut sa raison : demande-la si elle ne l'a pas donnée. Jamais le dossier de quelqu'un d'autre.",
      inputSchema: z.object({
        refs: z.array(z.string()).min(1).max(10).describe("identifiants (#K7QX3M) ou rangs (F001) donnés par myFacts"),
        reason: z.string().min(3).max(300).describe("pourquoi la personne veut la retirer, avec ses mots"),
      }),
      execute: async ({ refs, reason }) => {
        if (!allowed()) return refused("seulement quand la personne te le demande");
        const facts = await list();
        const ids = refs.flatMap((ref) => {
          const fact = pick(facts, ref);
          return fact ? [fact.id] : [];
        });
        if (ids.length === 0) return refused("aucune de ces références n'existe : appelle myFacts");
        const removed = await forgetOwnFacts(ctx.db, owner, ids, reason.trim(), "discord");
        ctx.log.info({ memberId: owner, count: removed.length }, "facts removed by their owner");
        return { ok: true, removed, note: "Retiré du dossier. Le résumé sera réécrit dans les minutes qui viennent." };
      },
    }),

    correctMyFact: tool({
      description:
        "Remplace un fragment du dossier de la personne qui te parle par sa version à elle (« je suis en master, pas en licence »). Appelle myFacts d'abord. L'ancienne version reste dans l'historique et ne sera pas réapprise.",
      inputSchema: z.object({
        ref: z.string().describe("identifiant (#K7QX3M) ou rang (F001) donné par myFacts"),
        content: z.string().describe("la bonne version, une phrase courte à la 3e personne, sans le nom"),
        reason: z.string().max(300).default("").describe("ce qu'elle a dit pour justifier, si elle l'a dit"),
      }),
      execute: async ({ ref, content, reason }) => {
        if (!allowed()) return refused("seulement quand la personne te le demande");
        const problem = checkOwnFactText(content);
        if (problem) return refused(problem);
        const facts = await list();
        const fact = pick(facts, ref);
        if (!fact) return refused("cette référence n'existe pas : appelle myFacts");
        const changed = await correctOwnFact(ctx.db, owner, fact.id, content.trim(), reason.trim(), "discord");
        if (!changed) return refused("cette info a déjà changé : appelle myFacts");
        ctx.log.info({ memberId: owner }, "fact corrected by its owner");
        return { ok: true, ...changed, note: "Corrigé. Le résumé sera réécrit dans les minutes qui viennent." };
      },
    }),
  };
}
