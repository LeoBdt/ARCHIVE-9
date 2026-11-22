import { checkSkill } from "@archive-9/ai";
import { checkSkillDraft, parseUntil, SKILL_KINDS, SKILL_LIMITS } from "@archive-9/core";
import { activeSkills, createSkill, deleteSkill, findActiveSkill, skillCounts } from "@archive-9/db";
import { tool } from "ai";
import { z } from "zod";
import { isAdmin, refused, requesterMember, type ToolContext } from "./context.ts";

/** Marks the small model's skill check in ai_usage, so it isn't read as a triage. */
export const SKILL_CHECK_DETAIL = "vérification de skill";

export function createSkillTools(ctx: ToolContext) {
  const requesterId = ctx.target.author.id;

  return {
    createSkill: tool({
      description:
        "Crée une skill demandée par un membre : une consigne que tu suivras. « permanent » : toujours appliquée (pour une manie générale). « triggered » : seulement quand un message contient un des mots déclencheurs (pour un sujet précis). Choisis toi-même le type, un nom court et les déclencheurs. Pour une consigne limitée dans le temps (« jusqu'à 21h », « ce soir »), donne « until ».",
      inputSchema: z.object({
        name: z.string().describe("nom court et unique"),
        kind: z.enum(SKILL_KINDS),
        triggers: z.array(z.string()).default([]).describe("mots ou expressions qui déclenchent la skill (type triggered)"),
        rule: z.string().describe("la consigne, écrite pour toi, en une ou deux phrases"),
        until: z.string().optional().describe("heure de fin, heure locale : « 21:00 », ou « 2026-11-23 18:30 » pour un autre jour ; une semaine au plus"),
      }),
      execute: async ({ until, ...input }) => {
        if (!ctx.addressed || ctx.target.author.bot) return refused("une skill se crée seulement à la demande d'un membre");
        const check = checkSkillDraft(input);
        if (!check.ok) return refused(check.reason);
        const expiresAt = until ? parseUntil(until, ctx.timezone, new Date()) : null;
        if (until && !expiresAt) return refused("heure de fin illisible, passée ou à plus d'une semaine");
        const counts = await skillCounts(ctx.db, requesterId);
        if (counts.byAuthor >= SKILL_LIMITS.perMember) return refused(`${String(SKILL_LIMITS.perMember)} skills par personne au maximum`);
        if (counts.total >= SKILL_LIMITS.total) return refused(`le serveur a déjà ${String(SKILL_LIMITS.total)} skills`);
        if (check.draft.kind === "permanent" && counts.permanent >= SKILL_LIMITS.permanent) {
          return refused(`déjà ${String(SKILL_LIMITS.permanent)} skills permanentes : propose-la avec des déclencheurs`);
        }
        if (await findActiveSkill(ctx.db, check.draft.name)) return refused("une skill porte déjà ce nom");

        const { verdict, usage } = await checkSkill(ctx.ai, check.draft);
        await ctx.saveUsage(usage, `${SKILL_CHECK_DETAIL} : ${verdict.ok ? "acceptée" : verdict.reason}`);
        if (!verdict.ok) return refused(verdict.reason);
        const id = await createSkill(ctx.db, check.draft, requesterId, expiresAt);
        if (!id) return refused("une skill porte déjà ce nom");
        ctx.log.info({ skillId: id, authorId: requesterId, kind: check.draft.kind }, "skill created");
        const ends = expiresAt?.toLocaleString("fr-FR", { timeZone: ctx.timezone, weekday: "long", hour: "2-digit", minute: "2-digit" });
        return { ok: true, created: check.draft, ...(ends ? { until: ends } : {}) };
      },
    }),

    deleteSkill: tool({
      description: "Supprime une skill, à la demande de son auteur ou d'un admin.",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        if (!ctx.addressed || ctx.target.author.bot) return refused("seulement à la demande d'un membre");
        const skill = await findActiveSkill(ctx.db, name);
        if (!skill) return refused("aucune skill de ce nom");
        if (skill.authorId !== requesterId) {
          const member = await requesterMember(ctx);
          if (!member || !isAdmin(member)) return refused("seuls son auteur et les admins peuvent la supprimer");
        }
        await deleteSkill(ctx.db, skill.id, requesterId);
        return { ok: true, deleted: skill.name };
      },
    }),

    listSkills: tool({
      description: "Liste les skills du serveur (nom, type, auteur, consigne).",
      inputSchema: z.object({}),
      execute: async () => {
        const skills = await activeSkills(ctx.db);
        return {
          ok: true,
          count: skills.length,
          skills: skills.slice(0, 50).map((s) => ({
            name: s.name,
            kind: s.kind,
            triggers: s.triggers,
            author: s.authorName,
            rule: s.rule,
            until: s.expiresAt?.toLocaleString("fr-FR", { timeZone: ctx.timezone, weekday: "long", hour: "2-digit", minute: "2-digit" }) ?? null,
          })),
        };
      },
    }),
  };
}
