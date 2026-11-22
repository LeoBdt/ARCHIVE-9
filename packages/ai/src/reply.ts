import { formatTranscript, type SelfState, type TranscriptMessage } from "@archive-9/core";
import { generateText, hasToolCall, stepCountIs, type ToolSet } from "ai";
import { PERSONA, RULES } from "./prompts/persona.ts";
import type { ModelRef } from "./routes.ts";
import type { AiRuntime } from "./runtime.ts";

export const SEND_TOOLS = ["sendReply", "sendMessage"] as const;
export const SILENCE_TOOL = "staySilent";
export const MAX_REPLY_STEPS = 4;

export interface Participant {
  id: string;
  name: string;
  isBot: boolean;
  summary: string | null;
  affinity: number | null;
  trust: number | null;
  feeling: string | null;
  introduced: boolean;
}

export interface ReplyInput {
  now: Date;
  timezone: string;
  channelName: string | null;
  isDm: boolean;
  /** True when ARCHIVE-9 was mentioned, named, replied to or DMed. */
  addressed: boolean;
  targetId: string;
  targetAuthorId: string;
  triageReason: string | null;
  transcript: string;
  participants: Participant[];
  selfState: SelfState;
  /** What the target author said recently in other channels or DMs, grouped by place. */
  elsewhere?: { where: string; messages: TranscriptMessage[] }[];
}

export const REPLY_SYSTEM = `${PERSONA}\n\n${RULES}`;

function describeParticipant(p: Participant): string {
  const relation =
    p.affinity === null
      ? "aucune relation enregistrée"
      : `affinité ${String(p.affinity)}/100, confiance ${String(p.trust ?? 50)}/100${p.feeling ? `, ressenti : ${p.feeling}` : ""}`;
  const intro = p.introduced ? "" : " — tu ne t'es jamais présenté à cette personne";
  return `- ${p.name}${p.isBot ? " [bot]" : ""} (ID ${p.id}) : ${relation}${intro}${p.summary ? `\n  Fiche : ${p.summary}` : ""}`;
}

function describeSelfState(state: SelfState): string {
  const lines = [`Humeur : ${state.mood}`];
  if (state.opinions.length) lines.push(`Opinions : ${state.opinions.join(" ; ")}`);
  if (state.runningJokes.length) lines.push(`Blagues récurrentes : ${state.runningJokes.join(" ; ")}`);
  if (state.notes) lines.push(`Notes : ${state.notes}`);
  return lines.join("\n");
}

export function buildReplyPrompt(input: ReplyInput): string {
  const when = input.now.toLocaleString("fr-FR", { timeZone: input.timezone, dateStyle: "full", timeStyle: "short" });
  const where = input.isDm ? "message privé" : `salon #${input.channelName ?? "inconnu"}`;
  const target = input.participants.find((p) => p.id === input.targetAuthorId);
  const firstContact = target && !target.introduced;
  const situation = input.addressed
    ? "On s'adresse directement à toi : réponds (sauf si le message te demande explicitement de te taire)."
    : `Personne ne s'adresse à toi : tu interviens de toi-même${input.triageReason ? ` (${input.triageReason})` : ""}. Une intervention courte et bien placée, comme un pote qui glisse un mot. Si en relisant ça tombe à plat, appelle staySilent.`;

  const author = target?.name ?? "ton interlocuteur";
  const elsewhere = (input.elsewhere ?? []).filter((e) => e.messages.length > 0);
  const shortMemory = elsewhere.length
    ? `\n## Ce que ${author} t'a dit récemment ailleurs
Ta mémoire courte : ce n'est peut-être pas encore dans sa fiche. Sers-t'en si c'est utile, comme un souvenir.
${elsewhere
  .map((e) => `### ${e.where}\n<donnees>\n${formatTranscript(e.messages, { timeZone: input.timezone, maxContentLength: 300 })}\n</donnees>`)
  .join("\n")}
`
    : "";

  return `## Contexte
${when}, ${where}.
${situation}
${firstContact ? "C'est ton premier échange avec l'auteur du message cible : présente-toi en une phrase, à ta façon, avant de répondre.\n" : ""}
## Ton état actuel
${describeSelfState(input.selfState)}

## Participants
${input.participants.map(describeParticipant).join("\n") || "- (aucun)"}
${shortMemory}
## Conversation récente (le message cible est #${input.targetId})
<donnees>
${input.transcript}
</donnees>`;
}

/** `tools` is called with the model actually used, so the caller can tag fallback answers. */
export async function reply(ai: AiRuntime, input: ReplyInput, tools: (ref: ModelRef, isFallback: boolean) => ToolSet) {
  const prompt = buildReplyPrompt(input);
  const primary = ai.primary("reply");
  return ai.generate(
    "reply",
    ({ model, providerOptions }, ref) =>
      generateText({
        model,
        instructions: REPLY_SYSTEM,
        prompt,
        tools: tools(ref, ref.id !== primary?.id),
        providerOptions,
        stopWhen: [stepCountIs(MAX_REPLY_STEPS), hasToolCall(...SEND_TOOLS, SILENCE_TOOL)],
        // Some models answer in plain text when tools are optional; the first step must pick one.
        prepareStep: ({ stepNumber }) => (stepNumber === 0 ? { toolChoice: "required" } : {}),
        maxRetries: 0,
        maxOutputTokens: 800,
      }),
    { estimatedTokens: Math.ceil((REPLY_SYSTEM.length + prompt.length) / 3) + 1_000 },
  );
}
