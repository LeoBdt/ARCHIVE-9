import { lt } from "drizzle-orm";
import type { Database } from "../client.ts";
import { decisions, type DecisionDetails } from "../schema.ts";

export interface DecisionInput {
  runId?: string | null;
  messageId: string;
  channelId: string;
  channelName?: string | null;
  guildId: string | null;
  authorId: string;
  outcome: "ignored" | "silent" | "replied" | "reacted" | "offline";
  reason?: string | null;
  addressed?: boolean;
  inAgents?: boolean;
  interest?: number | null;
  content?: string | null;
  details?: DecisionDetails | null;
}

export async function recordDecision(db: Database, input: DecisionInput): Promise<void> {
  await db.insert(decisions).values({ ...input, content: input.content?.slice(0, 500) ?? null });
}

export async function purgeDecisions(db: Database, before: Date): Promise<number> {
  const rows = await db.delete(decisions).where(lt(decisions.createdAt, before)).returning({ id: decisions.id });
  return rows.length;
}
