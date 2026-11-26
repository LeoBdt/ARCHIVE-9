import { readFileSync } from "node:fs";
import { embedTexts } from "@archive-9/ai";
import { AI_TASKS, fragmentCode, isEmptySearch, normaliseName, parseFragmentRef, parseSearchQuery, truncate } from "@archive-9/core";
import {
  addNotes,
  aiCostSince,
  dossier,
  dossierFacts,
  factByRef,
  latestReleases,
  listCategories,
  notesToday,
  searchArchives,
  similarFacts,
  storageStats,
  vectorStoreReady,
} from "@archive-9/db";
import { tool } from "ai";
import { z } from "zod";
import { refused, type ToolContext } from "./context.ts";

const DOCS = new URL("../../../../docs/ARCHITECTURE.md", import.meta.url);
const DAY_MS = 24 * 60 * 60_000;

/** Its own technical documentation, cut into sections by heading. */
export function docSections(markdown: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1]?.trim() ?? "", body: "" };
    } else if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ title: s.title, body: s.body.replace(/```mermaid[\s\S]*?```/g, "").trim() }));
}

/** The sections that best match a topic, by shared words. */
export function findSections(sections: { title: string; body: string }[], topic: string, max = 3): { title: string; body: string }[] {
  const words = normaliseName(topic).split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];
  return sections
    .map((s) => {
      const title = normaliseName(s.title);
      const body = normaliseName(s.body);
      return { s, score: words.reduce((n, w) => n + (title.includes(w) ? 5 : 0) + (body.split(w).length - 1), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.s);
}

let docsCache: { title: string; body: string }[] | null = null;
function docs(): { title: string; body: string }[] {
  try {
    docsCache ??= docSections(readFileSync(DOCS, "utf8"));
  } catch {
    docsCache = [];
  }
  return docsCache;
}

/** Read access to its whole memory, its numbers and its own documentation. */
export function createMemoryTools(ctx: ToolContext) {
  const viewer = { id: ctx.target.author.id, isAdmin: false };
  const publicChannels = () => ctx.settings.value.channelDirectory.filter((c) => c.isPublic).map((c) => c.id);
  const day = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR", { timeZone: ctx.timezone, day: "numeric", month: "short", year: "numeric" });

  return {
    searchArchives: tool({
      description:
        "Fouille toute ta mémoire : fragments, messages archivés (salons publics et MP de la personne qui te parle), dossiers, skills, ton journal de réponses, tes relations. Mots libres (accents et fautes tolérés), \"phrase exacte\", @nom pour une personne, #K7QX3M pour un fragment, F012 avec @nom, tiroir:jeux, nature:blague, type:messages, après:20/11, avant:25/11. Cherche aussi par le sens dans les fragments.",
      inputSchema: z.object({ query: z.string().min(1).max(300) }),
      execute: async ({ query }) => {
        const q = parseSearchQuery(query);
        if (isEmptySearch(q)) return refused("requête vide");
        const results = await searchArchives(ctx.db, q, viewer, { publicChannelIds: publicChannels(), limit: 12 });
        const semantic =
          q.text && (await vectorStoreReady(ctx.db)) && ctx.embedding
            ? await embedTexts(ctx.embedding, [q.text]).then(async (o) => {
                await ctx.saveUsage([o.usage], "recherche par le sens");
                return o.vectors?.[0] ? similarFacts(ctx.db, o.vectors[0], { memberIds: results.people.map((p) => p.id), limit: 8, min: 0.55 }) : [];
              })
            : [];
        const seen = new Set(results.fragments.map((f) => f.id));
        return {
          ok: true,
          people: results.people.map((p) => p.name),
          fragments: [
            ...results.fragments.map((f) => ({ id: `#${f.ref}`, rank: fragmentCode(f.rank), who: f.memberName, drawer: f.categoryLabel ?? f.category, nature: f.nature, confidence: f.confidence, content: f.content, since: day(f.createdAt) })),
            ...semantic.filter((f) => !seen.has(f.id)).map((f) => ({ id: `#${f.ref}`, who: f.memberName, drawer: f.category, nature: f.nature, confidence: f.confidence, content: f.content, byMeaning: Number(f.similarity.toFixed(2)) })),
          ],
          messages: results.messages.map((m) => ({ who: m.authorName, where: m.guildId === null ? "MP" : `#${ctx.settings.value.channelDirectory.find((c) => c.id === m.channelId)?.name ?? "salon"}`, at: day(m.createdAt), content: truncate(m.content, 200), images: m.images ?? undefined })),
          dossiers: results.dossiers.map((d) => ({ name: d.name, fragments: d.facts, tagline: d.tagline })),
          skills: results.skills.map((k) => ({ name: k.name, rule: truncate(k.rule, 160), author: k.authorName })),
          replies: results.journal.map((j) => ({ to: j.authorName, at: day(j.createdAt), asked: truncate(j.content ?? "", 140), said: truncate(j.sent ?? "", 160) })),
          relations: results.relations.map((r) => ({ who: r.memberName, at: day(r.createdAt), affinity: r.affinityDelta, trust: r.trustDelta, why: r.reason })),
        };
      },
    }),

    readFragment: tool({
      description: "Un fragment par son identifiant (#K7QX3M) : ce qu'il dit, sa nature, ta confiance, son tiroir, ses versions et ce que ton rangement en a fait.",
      inputSchema: z.object({ id: z.string().describe("#K7QX3M") }),
      execute: async ({ id }) => {
        const ref = parseFragmentRef(id);
        if (!ref) return refused("identifiant illisible : six caractères, comme #K7QX3M");
        const fact = await factByRef(ctx.db, ref);
        if (!fact) return refused("aucun fragment avec cet identifiant");
        return {
          ok: true,
          id: `#${fact.ref}`,
          about: fact.memberName,
          current: fact.current,
          deleted: fact.deletedAt ? { at: day(fact.deletedAt), by: fact.deletedBy } : null,
          drawer: fact.categoryLabel ?? fact.category,
          nature: fact.nature,
          confidence: fact.confidence,
          content: fact.content,
          sources: fact.sourceMessageIds.length,
          versions: fact.versions.map((v) => ({ at: day(v.createdAt), content: v.content, current: v.current })),
          tidy: fact.operations.map((o) => ({ op: o.op, status: o.status, why: o.reason, at: day(o.createdAt) })),
        };
      },
    }),

    readDossier: tool({
      description: "Le dossier complet d'une personne (ou du serveur) : résumé, relation, et tous ses fragments tiroir par tiroir, avec leur identifiant.",
      inputSchema: z.object({ person: z.string().describe("son nom, @nom ou son ID") }),
      execute: async ({ person }) => {
        const id = /^\d{17,20}$/.test(person.trim()) ? person.trim() : ctx.findMembers(person.replace(/^@/, ""), 1)[0];
        if (!id) return refused("je ne trouve personne de ce nom");
        const [data, facts, drawers] = await Promise.all([dossier(ctx.db, id), dossierFacts(ctx.db, id), listCategories(ctx.db, id)]);
        if (!data) return refused("pas de dossier pour cette personne");
        const label = new Map(drawers.map((d) => [d.key, d.memberId ? `${d.label} (perso)` : d.label]));
        const byDrawer: Record<string, { id: string; rank: string; nature: string; confidence: number; content: string }[]> = {};
        for (const f of facts.slice(0, 120)) {
          const key = label.get(f.category) ?? f.category;
          (byDrawer[key] ??= []).push({ id: `#${f.ref}`, rank: fragmentCode(f.rank), nature: f.nature, confidence: f.confidence, content: f.content });
        }
        return { ok: true, name: data.name, summary: data.summary, tagline: data.tagline, relationship: data.relationship, fragments: facts.length, drawers: byDrawer };
      },
    }),

    myStats: tool({
      description: "Tes chiffres réels : messages, fragments, images, tiroirs, taille de ta base, tes coûts d'IA (24 h et 7 jours, par tâche), ta version et ton changelog, tes réglages.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = Date.now();
        const [storage, releases, vectors, ...costs] = await Promise.all([
          storageStats(ctx.db),
          latestReleases(ctx.db, "core", 1),
          vectorStoreReady(ctx.db),
          ...AI_TASKS.map((task) => Promise.all([aiCostSince(ctx.db, [task], new Date(now - DAY_MS)), aiCostSince(ctx.db, [task], new Date(now - 7 * DAY_MS))])),
        ]);
        const s = ctx.settings.value;
        return {
          ok: true,
          counts: storage.counts,
          biggestTables: storage.tables.slice(0, 6).map((t) => ({ table: t.name, rows: t.rows, megabytes: Number((t.bytes / 1_048_576).toFixed(1)) })),
          costsUsd: Object.fromEntries(AI_TASKS.map((task, i) => [task, { day: Number((costs[i]?.[0] ?? 0).toFixed(4)), week: Number((costs[i]?.[1] ?? 0).toFixed(4)) }])),
          version: s.botVersion,
          changelog: releases[0] ? { label: releases[0].label, comment: releases[0].comment, items: releases[0].items.map((i) => i.text).slice(0, 12) } : null,
          searchByMeaning: vectors,
          settings: { paused: s.paused, spontaneity: s.spontaneity, reflectionHours: s.reflectionHours, tidyDryRun: s.tidyDryRun, listenedChannels: s.listenedChannelIds.length },
        };
      },
    }),

    howIWork: tool({
      description: "Ta propre documentation technique, toujours à jour avec ton code. Sans sujet : la liste des sections. Avec un sujet (« analyse », « skills », « relations », « images »…) : les sections qui en parlent.",
      inputSchema: z.object({ topic: z.string().max(100).optional() }),
      execute: ({ topic }) => {
        const all = docs();
        if (all.length === 0) return refused("ma documentation n'est pas disponible ici");
        if (!topic?.trim()) return { ok: true, sections: all.map((s) => s.title) };
        const found = findSections(all, topic);
        if (found.length === 0) return { ok: true, nothing: true, sections: all.map((s) => s.title) };
        return { ok: true, sections: found.map((s) => ({ title: s.title, text: truncate(s.body, 2_500) })) };
      },
    }),

    noteForCreator: tool({
      description:
        "Écris dans ton carnet pour ton créateur, quand tu te heurtes à une vraie limite : ce qui te manque (gap : un outil, une capacité) ou ce que tu aimerais changer chez toi (wish). Il le lira et te répondra. Pas pour une consigne (c'est une skill) ni pour un retour d'un membre (noteFeedback).",
      inputSchema: z.object({ kind: z.enum(["gap", "wish"]), content: z.string().min(5).max(300).describe("une phrase, à la 1re personne"), why: z.string().max(200).describe("ce qui vient de se passer") }),
      execute: async ({ kind, content, why }) => {
        if ((await notesToday(ctx.db)) >= 3) return refused("déjà 3 notes aujourd'hui : garde-la pour ta réflexion du soir");
        await addNotes(ctx.db, [{ kind, content: content.trim(), why: why.trim() }], null, "conversation");
        return { ok: true, note: "C'est noté dans ton carnet." };
      },
    }),
  };
}
