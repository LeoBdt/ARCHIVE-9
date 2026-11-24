import {
  BASE_CATEGORY_INFO,
  FACT_NATURES,
  formatTranscript,
  truncate,
  type CategoryInfo,
  type FactCategory,
  type FactNature,
  type TranscriptMessage,
} from "@archive-9/core";
import { generateText, Output } from "ai";
import { z } from "zod";
import { ANALYSIS_SYSTEM } from "./prompts/analysis.ts";
import type { ModelRef } from "./routes.ts";
import type { AiRuntime } from "./runtime.ts";
import { readStructured, structuredProblem } from "./structured.ts";
import type { UsageRecord } from "./usage.ts";

export interface KnownFact {
  id: string;
  category: FactCategory;
  nature: FactNature;
  confidence: number;
  content: string;
}

export interface AnalysisParticipant {
  id: string;
  name: string;
  isBot: boolean;
  /** The server's own profile, where group-level facts go. */
  isServer?: boolean;
  summary: string | null;
  affinity: number | null;
  trust: number | null;
  feeling: string | null;
  /** Current facts, most recent first. They get short references (F1, F2…) in the prompt. */
  facts: KnownFact[];
  /** What the person took off their own profile, with their reason. */
  removed?: { content: string; newContent?: string | null; reason: string }[];
}

export interface AnalysisConversation {
  channelName: string | null;
  /** Earlier messages, already analysed, shown only to understand the start. */
  context: TranscriptMessage[];
  messages: TranscriptMessage[];
}

export interface ServerContext {
  id: string;
  name: string;
  /** What ARCHIVE-9 learned about the server. */
  summary: string | null;
}

export interface AnalysisInput {
  selfId: string;
  timezone: string;
  server?: ServerContext;
  participants: AnalysisParticipant[];
  conversations: AnalysisConversation[];
  /** The drawers facts can go in; the starting ones when absent. */
  categories?: CategoryInfo[];
}

export const BASE_CATEGORIES: CategoryInfo[] = Object.entries(BASE_CATEGORY_INFO).map(([key, info]) => ({ key, ...info }));

export const MAX_FACTS_PER_BATCH = 20;

export const analysisSchema = z.object({
  facts: z.array(
    z.object({
      memberId: z.string().describe("ID Discord de la personne concernée"),
      category: z.string().describe("clé d'un tiroir de la liste (games, tastes…)"),
      nature: z.enum(FACT_NATURES),
      confidence: z.number().describe("entre 0 et 1"),
      content: z.string().describe("une phrase courte, 3e personne, sans le nom"),
      sourceMessageIds: z.array(z.string()).describe("ID des messages sources, sans #"),
      reportedBy: z.string().nullable().describe("ID de celui qui rapporte l'info, si nature = reported"),
      replaces: z.string().nullable().describe("référence de l'info connue que celle-ci remplace (F3), sinon null"),
    }),
  ),
  retractions: z.array(
    z.object({
      ref: z.string().describe("référence de l'info à oublier (F3)"),
      reason: z.string(),
    }),
  ),
  relationships: z.array(
    z.object({
      memberId: z.string(),
      affinityDelta: z.number().describe("entier entre -5 et 5"),
      trustDelta: z.number().describe("entier entre -5 et 5"),
      reason: z.string(),
      sourceMessageId: z.string().nullable(),
      feeling: z.string().nullable().describe("ce qu'ARCHIVE-9 ressent pour cette personne, ou null"),
      howTheyTreatMe: z.string().nullable().describe("comment cette personne traite ARCHIVE-9, ou null"),
    }),
  ),
});

export type RawAnalysis = z.infer<typeof analysisSchema>;

export interface LearnedFact {
  memberId: string;
  category: FactCategory;
  nature: FactNature;
  confidence: number;
  content: string;
  sourceMessageIds: string[];
  reportedBy: string | null;
  replacesId: string | null;
}

export interface Retraction {
  factId: string;
  memberId: string;
}

export interface RelationshipUpdate {
  memberId: string;
  affinityDelta: number;
  trustDelta: number;
  reason: string;
  sourceMessageId: string | null;
  feeling: string | null;
  howTheyTreatMe: string | null;
}

export interface AnalysisResult {
  facts: LearnedFact[];
  retractions: Retraction[];
  relationships: RelationshipUpdate[];
}

export interface AnalysisOutcome {
  result: AnalysisResult | null;
  ref: ModelRef | null;
  usage: UsageRecord[];
}

/** Short references for known facts, in participant order: F1, F2… */
export function factRefs(participants: readonly AnalysisParticipant[]): Map<string, KnownFact & { memberId: string }> {
  const refs = new Map<string, KnownFact & { memberId: string }>();
  for (const p of participants) for (const fact of p.facts) refs.set(`F${String(refs.size + 1)}`, { ...fact, memberId: p.id });
  return refs;
}

const NATURE_LABELS: Record<FactNature, string> = {
  fact: "fait",
  reported: "rapporté",
  probable_joke: "blague probable",
  inference: "déduction",
};

function describeParticipant(p: AnalysisParticipant, refOf: Map<string, string>): string {
  const relation = p.isServer
    ? "le serveur lui-même, pour ce qui concerne tout le groupe"
    : p.affinity === null
      ? "aucune relation"
      : `affinité ${String(p.affinity)}/100, confiance ${String(p.trust ?? 50)}/100${p.feeling ? `, ressenti : ${p.feeling}` : ""}`;
  const lines = [`- ${p.name}${p.isBot ? " [bot]" : ""} (ID ${p.id}) · ${relation}`];
  if (p.summary) lines.push(`  Fiche : ${p.summary}`);
  if (p.facts.length === 0) lines.push("  Aucune info connue.");
  for (const fact of p.facts) {
    lines.push(`  ${refOf.get(fact.id) ?? "?"} · ${fact.category} · ${NATURE_LABELS[fact.nature]} · ${fact.confidence.toFixed(1)} · ${fact.content}`);
  }
  if (p.removed?.length) {
    lines.push("  Corrigé ou retiré par la personne elle-même (ne réapprends pas l'ancienne version) :");
    for (const r of p.removed) {
      const why = r.reason ? ` (raison : ${r.reason})` : "";
      lines.push(r.newContent ? `  ✎ ${r.content} → ${r.newContent}${why}` : `  ✕ ${r.content}${why}`);
    }
  }
  return lines.join("\n");
}

export function buildAnalysisPrompt(input: AnalysisInput): string {
  const refOf = new Map([...factRefs(input.participants)].map(([ref, fact]) => [fact.id, ref]));
  const names = new Map(input.participants.map((p) => [p.id, p.name]));
  const options = { timeZone: input.timezone, selfLabel: "ARCHIVE-9", maxContentLength: 600, names };
  const conversations = input.conversations.map((c, index) => {
    const first = c.messages[0]?.createdAt ?? new Date(0);
    const day = first.toLocaleDateString("fr-FR", { timeZone: input.timezone, dateStyle: "full" });
    const context = c.context.length ? `(contexte, déjà analysé)\n${formatTranscript(c.context, options)}\n(à analyser)\n` : "";
    return `## Conversation ${String(index + 1)} · #${c.channelName ?? "inconnu"} · ${day}
<donnees>
${context}${formatTranscript(c.messages, options)}
</donnees>`;
  });

  const drawers = (input.categories ?? BASE_CATEGORIES).map((c) => `- ${c.key} : ${c.label}`).join("\n");
  return `ARCHIVE-9 a l'ID ${input.selfId}.
${input.server ? `\n## Le serveur\n${describeServer(input.server)}\n` : ""}
## Les tiroirs (category : la clé à gauche)
${drawers}

## Participants
${input.participants.map((p) => describeParticipant(p, refOf)).join("\n") || "- (aucun)"}

${conversations.join("\n\n")}`;
}

/** The learned part of the server, shared by the analysis, reply and reflection prompts. */
export function describeServer(server: ServerContext): string {
  const lines = [`Nom : ${server.name} (ID ${server.id}).`];
  if (server.summary) lines.push(`Ce que tu en as appris : ${server.summary}`);
  return lines.join("\n");
}

function cleanId(value: string): string {
  return value.trim().replace(/^(#|ID\s*)/i, "");
}

function cleanText(value: string | null, max: number): string | null {
  const text = value?.trim();
  return text ? truncate(text, max) : null;
}

function clampDelta(value: number): number {
  return Number.isFinite(value) ? Math.max(-5, Math.min(5, Math.round(value))) : 0;
}

/**
 * Keeps only what the model may legitimately write: facts about listed participants,
 * backed by messages of the batch, corrections of their own facts. Anything else is dropped.
 */
export function sanitiseAnalysis(raw: RawAnalysis, input: AnalysisInput): AnalysisResult {
  const members = new Set(input.participants.map((p) => p.id).filter((id) => id !== input.selfId));
  const serverIds = new Set(input.participants.filter((p) => p.isServer).map((p) => p.id));
  const refs = factRefs(input.participants);
  const authorOf = new Map(input.conversations.flatMap((c) => c.messages.map((m) => [m.id, m.authorId] as const)));
  const drawers = new Set((input.categories ?? BASE_CATEGORIES).map((c) => c.key));

  const facts: LearnedFact[] = [];
  const seen = new Set<string>();
  for (const f of raw.facts) {
    const memberId = cleanId(f.memberId);
    const content = cleanText(f.content, 200);
    if (!members.has(memberId) || !content || seen.has(`${memberId}:${content.toLowerCase()}`)) continue;
    const sources = [...new Set(f.sourceMessageIds.map(cleanId))].filter((id) => authorOf.has(id));
    // ARCHIVE-9's own words (jokes, delirium, mistakes) are never enough to learn something.
    if (!sources.some((id) => authorOf.get(id) !== input.selfId)) continue;

    const sourceAuthors = sources.map((id) => authorOf.get(id) ?? "");
    // The server never writes: its facts are never "reported" by someone.
    const saidByThemself = serverIds.has(memberId) || sourceAuthors.includes(memberId);
    // A "fact" is something people say about themselves; anything else is reported.
    const nature: FactNature = f.nature === "fact" && !saidByThemself ? "reported" : f.nature;
    const claimedReporter = f.reportedBy ? cleanId(f.reportedBy) : null;
    const reportedBy =
      nature !== "reported" || serverIds.has(memberId)
        ? null
        : claimedReporter && claimedReporter !== memberId && members.has(claimedReporter)
          ? claimedReporter
          : (sourceAuthors.find((id) => id !== memberId && members.has(id)) ?? null);
    const replaced = f.replaces ? refs.get(f.replaces.trim().toUpperCase()) : undefined;

    seen.add(`${memberId}:${content.toLowerCase()}`);
    facts.push({
      memberId,
      category: drawers.has(f.category.trim()) ? f.category.trim() : "other",
      nature,
      confidence: Number.isFinite(f.confidence) ? Math.max(0, Math.min(1, f.confidence)) : 0.5,
      content,
      sourceMessageIds: sources,
      reportedBy,
      replacesId: replaced?.memberId === memberId ? replaced.id : null,
    });
    if (facts.length === MAX_FACTS_PER_BATCH) break;
  }

  const retractions = new Map<string, Retraction>();
  for (const r of raw.retractions) {
    const fact = refs.get(r.ref.trim().toUpperCase());
    if (fact) retractions.set(fact.id, { factId: fact.id, memberId: fact.memberId });
  }

  const relationships = new Map<string, RelationshipUpdate>();
  for (const r of raw.relationships) {
    const memberId = cleanId(r.memberId);
    if (!members.has(memberId) || serverIds.has(memberId) || relationships.has(memberId)) continue;
    const sourceMessageId = r.sourceMessageId ? cleanId(r.sourceMessageId) : null;
    relationships.set(memberId, {
      memberId,
      affinityDelta: clampDelta(r.affinityDelta),
      trustDelta: clampDelta(r.trustDelta),
      reason: cleanText(r.reason, 200) ?? "sans précision",
      sourceMessageId: sourceMessageId && authorOf.has(sourceMessageId) ? sourceMessageId : null,
      feeling: cleanText(r.feeling, 120),
      howTheyTreatMe: cleanText(r.howTheyTreatMe, 200),
    });
  }

  return { facts, retractions: [...retractions.values()], relationships: [...relationships.values()] };
}

/** Reads a batch of finished conversations and extracts what ARCHIVE-9 learns from them. */
export async function analyse(ai: AiRuntime, input: AnalysisInput): Promise<AnalysisOutcome> {
  const prompt = buildAnalysisPrompt(input);
  const outcome = await ai.generate(
    "analysis",
    ({ model, providerOptions }) =>
      generateText({
        model,
        instructions: ANALYSIS_SYSTEM,
        prompt,
        output: Output.object({ schema: analysisSchema }),
        providerOptions,
        maxRetries: 2,
        maxOutputTokens: 16_000,
        temperature: 0.3,
      }),
    {
      estimatedTokens: Math.ceil((ANALYSIS_SYSTEM.length + prompt.length) / 3) + 3_000,
      accept: (result) => readStructured(result, analysisSchema) !== null,
      explain: (result) => structuredProblem(result, analysisSchema),
    },
  );
  if (!outcome.ok) return { result: null, ref: null, usage: outcome.usage };
  const raw = readStructured(outcome.result, analysisSchema);
  return { result: raw ? sanitiseAnalysis(raw, input) : null, ref: outcome.ref, usage: outcome.usage };
}
