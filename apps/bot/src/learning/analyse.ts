import { randomUUID } from "node:crypto";
import { analyse, summarise, type AiRuntime, type AnalysisConversation, type UsageRecord } from "@archive-9/ai";
import { CONVERSATION_GAP_MS, groupConversations, packConversations, readyConversations } from "@archive-9/core";
import {
  applyAnalysis,
  contextBefore,
  currentFacts,
  deleteSummary,
  memberContexts,
  notify,
  participantProfiles,
  pendingMessages,
  recordAiUsage,
  saveSummary,
  type Database,
  type StoredMessage,
} from "@archive-9/db";
import type { Logger } from "../logger.ts";

export interface LearningDeps {
  db: Database;
  ai: AiRuntime;
  log: Logger;
  selfId: string;
  timezone: string;
  channelName: (channelId: string) => string | null;
}

export interface AnalysisOptions {
  /** Stop starting new batches once this much has been spent, in USD. */
  budgetUsd: number;
  /** Also analyse conversations still going on (their settled part). */
  includeOngoing: boolean;
  /** Called after each batch, e.g. to print progress. */
  onBatch?: (progress: { messages: number; costUsd: number }) => void;
}

export interface AnalysisReport {
  batches: number;
  messages: number;
  facts: number;
  summaries: number;
  costUsd: number;
  /** True when a batch failed; the remaining messages stay pending. */
  failed: boolean;
  budgetReached: boolean;
}

const BATCH_MESSAGES = 120;
const PASS_MESSAGES = 600;
const CONTEXT_MESSAGES = 6;
const FACTS_IN_PROMPT = 20;
const FACTS_IN_SUMMARY = 60;

function costOf(usage: UsageRecord[]): number {
  return usage.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
}

async function saveUsage(db: Database, usage: UsageRecord[], detail: string): Promise<void> {
  const runId = randomUUID();
  await recordAiUsage(
    db,
    usage.map((record) => ({ ...record, runId, detail: record.status === "ok" ? detail : null })),
  );
}

function participantIds(batch: StoredMessage[][], selfId: string): string[] {
  const ids = new Set<string>();
  for (const message of batch.flat()) {
    ids.add(message.authorId);
    for (const id of message.mentionedIds) ids.add(id);
  }
  ids.delete(selfId);
  return [...ids];
}

/**
 * Analyses pending messages, conversation by conversation, until none is left, a batch
 * fails or the budget is spent. Profile summaries of the members who changed are rewritten
 * once at the end.
 */
export async function runAnalysis(deps: LearningDeps, options: AnalysisOptions): Promise<AnalysisReport> {
  const { db, ai, log, selfId } = deps;
  const report: AnalysisReport = { batches: 0, messages: 0, facts: 0, summaries: 0, costUsd: 0, failed: false, budgetReached: false };
  const touched = new Set<string>();

  analysis: for (;;) {
    const now = new Date();
    const ready = readyConversations(groupConversations(await pendingMessages(db, selfId, now, PASS_MESSAGES)), now, options.includeOngoing);
    if (ready.length === 0) break;

    for (const batch of packConversations(ready, BATCH_MESSAGES)) {
      if (report.costUsd >= options.budgetUsd) {
        report.budgetReached = true;
        break analysis;
      }
      const conversations: AnalysisConversation[] = await Promise.all(
        batch.flatMap((messages) => (messages[0] ? [{ first: messages[0], messages }] : [])).map(async ({ first, messages }) => {
          return {
            channelName: first.guildId === null ? "message privé" : deps.channelName(first.channelId),
            context: await contextBefore(
              db,
              selfId,
              first.channelId,
              { since: new Date(first.createdAt.getTime() - CONVERSATION_GAP_MS), before: first.createdAt },
              CONTEXT_MESSAGES,
            ),
            messages,
          };
        }),
      );
      // Utility bots (music, moderation…) get no profile; the other AI bots do.
      const participants = (await participantProfiles(db, participantIds(batch, selfId), FACTS_IN_PROMPT)).filter(
        (p) => !p.isBot || p.isKnownAiBot,
      );
      const outcome = await analyse(ai, { selfId, timezone: deps.timezone, participants, conversations });
      const ids = batch.flat().map((m) => m.id);
      report.costUsd += costOf(outcome.usage);
      await saveUsage(db, outcome.usage, `${String(ids.length)} messages`);

      if (!outcome.result) {
        log.warn({ messages: ids.length }, "analysis batch failed");
        report.failed = true;
        break analysis;
      }
      const changed = await applyAnalysis(db, {
        ...outcome.result,
        analysedIds: ids,
        at: batch.flat().at(-1)?.createdAt ?? new Date(),
      });
      for (const id of changed) touched.add(id);
      report.batches += 1;
      report.messages += ids.length;
      report.facts += outcome.result.facts.length;
      options.onBatch?.({ messages: report.messages, costUsd: report.costUsd });
    }
  }

  report.summaries = await refreshSummaries(deps, [...touched], report);
  if (report.batches > 0) await notify(db, { type: "learned", memberIds: [...touched] });
  if (report.batches > 0 || report.failed) log.info(report, "analysis done");
  return report;
}

async function refreshSummaries(deps: LearningDeps, memberIds: string[], report: AnalysisReport): Promise<number> {
  const { db, ai } = deps;
  const people = new Map((await participantProfiles(db, memberIds, 0)).map((p) => [p.id, p]));
  const relations = await memberContexts(db, memberIds);
  let written = 0;
  for (const memberId of memberIds) {
    const person = people.get(memberId);
    if (!person) continue;
    const facts = await currentFacts(db, memberId, FACTS_IN_SUMMARY);
    if (facts.length === 0) {
      await deleteSummary(db, memberId);
      continue;
    }
    const outcome = await summarise(ai, {
      name: person.name,
      isBot: person.isBot,
      feeling: relations.get(memberId)?.feeling ?? null,
      facts,
    });
    report.costUsd += costOf(outcome.usage);
    await saveUsage(db, outcome.usage, `fiche ${memberId}`);
    if (!outcome.summary || !outcome.ref) continue;
    await saveSummary(db, { memberId, ...outcome.summary, factCount: facts.length, model: outcome.ref.model });
    written += 1;
  }
  return written;
}
