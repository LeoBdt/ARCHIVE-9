import type { AiCallStatus, AiTask } from "@archive-9/core";
import { and, arrayContains, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { aiUsage } from "../schema.ts";

export interface AiUsageInput {
  runId: string;
  task: AiTask;
  provider: string;
  model: string;
  upstreamProvider: string | null;
  fallbackReason: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  durationMs: number;
  status: AiCallStatus;
  error: string | null;
  /** Triage reason, or tools called by a reply. */
  detail?: string | null;
  replyMessageIds?: string[];
  version?: string | null;
}

export async function recordAiUsage(db: Database, rows: AiUsageInput[]): Promise<void> {
  if (rows.length > 0) await db.insert(aiUsage).values(rows);
}

/** Every AI call of the run that produced this Discord message (triage and reply). */
export async function runForMessage(db: Database, messageId: string) {
  const [match] = await db
    .select({ runId: aiUsage.runId })
    .from(aiUsage)
    .where(arrayContains(aiUsage.replyMessageIds, [messageId]))
    .limit(1);
  if (!match) return [];
  return db.select().from(aiUsage).where(eq(aiUsage.runId, match.runId)).orderBy(asc(aiUsage.createdAt));
}

/** Money spent on these tasks since `since`, in USD. */
export async function aiCostSince(db: Database, tasks: AiTask[], since: Date): Promise<number> {
  const [row] = await db
    .select({ cost: sql<string | null>`sum(${aiUsage.costUsd})` })
    .from(aiUsage)
    .where(and(inArray(aiUsage.task, tasks), gte(aiUsage.createdAt, since)));
  return Number(row?.cost ?? 0);
}
