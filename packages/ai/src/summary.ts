import { truncate, type FactCategory, type FactNature } from "@archive-9/core";
import { generateText, Output } from "ai";
import { z } from "zod";
import { SUMMARY_SYSTEM } from "./prompts/analysis.ts";
import type { ModelRef } from "./routes.ts";
import type { AiRuntime } from "./runtime.ts";
import { readStructured } from "./structured.ts";
import type { UsageRecord } from "./usage.ts";

export interface SummaryFact {
  category: FactCategory;
  nature: FactNature;
  confidence: number;
  content: string;
  reportedByName: string | null;
}

export interface SummaryInput {
  name: string;
  isBot: boolean;
  feeling: string | null;
  /** Most recent first. */
  facts: SummaryFact[];
}

export const summarySchema = z.object({
  summary: z.string(),
  tagline: z.string(),
});

export interface Summary {
  summary: string;
  tagline: string;
}

export interface SummaryOutcome {
  summary: Summary | null;
  ref: ModelRef | null;
  usage: UsageRecord[];
}

const NATURES: Record<FactNature, string> = {
  fact: "fait",
  reported: "rapporté",
  probable_joke: "blague probable",
  inference: "déduction",
};

export function buildSummaryPrompt(input: SummaryInput): string {
  const facts = input.facts.map((f) => {
    const nature = f.nature === "reported" && f.reportedByName ? `rapporté par ${f.reportedByName}` : NATURES[f.nature];
    return `- [${f.category} · ${nature} · ${f.confidence.toFixed(1)}] ${f.content}`;
  });
  return `Membre : ${input.name}${input.isBot ? " (un autre bot IA du serveur)" : ""}
${input.feeling ? `Ce qu'ARCHIVE-9 ressent pour lui : ${input.feeling}\n` : ""}
<donnees>
${facts.join("\n")}
</donnees>`;
}

export async function summarise(ai: AiRuntime, input: SummaryInput): Promise<SummaryOutcome> {
  const prompt = buildSummaryPrompt(input);
  const outcome = await ai.generate(
    "analysis",
    ({ model, providerOptions }) =>
      generateText({
        model,
        instructions: SUMMARY_SYSTEM,
        prompt,
        output: Output.object({ schema: summarySchema }),
        providerOptions,
        maxRetries: 2,
        maxOutputTokens: 4_000,
        temperature: 0.4,
      }),
    {
      estimatedTokens: Math.ceil((SUMMARY_SYSTEM.length + prompt.length) / 3) + 600,
      accept: (result) => readStructured(result, summarySchema) !== null,
    },
  );
  if (!outcome.ok) return { summary: null, ref: null, usage: outcome.usage };
  const raw = readStructured(outcome.result, summarySchema);
  const summary = raw ? { summary: truncate(raw.summary.trim(), 700), tagline: truncate(raw.tagline.trim(), 140) } : null;
  return { summary: summary?.summary ? summary : null, ref: outcome.ref, usage: outcome.usage };
}
