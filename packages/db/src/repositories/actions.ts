import type { ActionStatus, ActionTier } from "@archive-9/core";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { actionsLog } from "../schema.ts";

export interface ActionInput {
  tool: string;
  tier: ActionTier;
  params: Record<string, unknown>;
  status: ActionStatus;
  refusalReason?: string | null;
  /** What to put back on undo (old name, created channel ID…). */
  previousValue?: Record<string, unknown> | null;
  requestedBy: string | null;
  sourceMessageId: string | null;
}

export async function logAction(db: Database, input: ActionInput): Promise<string> {
  const [row] = await db.insert(actionsLog).values(input).returning({ id: actionsLog.id });
  if (!row) throw new Error("action not logged");
  return row.id;
}

/** Actions of this tool carried out since `since` (refusals and failures don't count). */
export async function countActions(db: Database, tool: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(actionsLog)
    .where(and(eq(actionsLog.tool, tool), gte(actionsLog.createdAt, since), sql`${actionsLog.status} in ('done', 'undone')`));
  return row?.n ?? 0;
}

/** Last controlled actions carried out, for `/actions`. */
export async function recentControlledActions(db: Database, limit = 10) {
  return db
    .select()
    .from(actionsLog)
    .where(and(eq(actionsLog.tier, "controlled"), sql`${actionsLog.status} in ('done', 'undone')`))
    .orderBy(desc(actionsLog.createdAt))
    .limit(limit);
}

export async function getAction(db: Database, id: string) {
  const [row] = await db.select().from(actionsLog).where(eq(actionsLog.id, id));
  return row;
}

/** Marks the action undone; false when someone already did it. */
export async function markUndone(db: Database, id: string, by: string): Promise<boolean> {
  const rows = await db
    .update(actionsLog)
    .set({ status: "undone", undoneAt: sql`now()`, undoneBy: by })
    .where(and(eq(actionsLog.id, id), eq(actionsLog.status, "done"), isNull(actionsLog.undoneAt)))
    .returning({ id: actionsLog.id });
  return rows.length > 0;
}

/** Puts an action back to done when its undo failed on Discord's side. */
export async function reopenAction(db: Database, id: string): Promise<void> {
  await db.update(actionsLog).set({ status: "done", undoneAt: null, undoneBy: null }).where(eq(actionsLog.id, id));
}

/**
 * Takes a pending action for its confirmation (or cancels it), once: a second click finds
 * nothing. A confirmed action counts as done from here; `finishAction` records what really happened.
 */
export async function claimPending(db: Database, id: string, status: "done" | "cancelled" = "done", refusalReason: string | null = null) {
  const [row] = await db
    .update(actionsLog)
    .set({ status, refusalReason })
    .where(and(eq(actionsLog.id, id), eq(actionsLog.status, "pending")))
    .returning();
  return row;
}

export async function finishAction(
  db: Database,
  id: string,
  result: { status: ActionStatus; refusalReason?: string | null; previousValue?: Record<string, unknown> | null },
): Promise<void> {
  await db.update(actionsLog).set(result).where(eq(actionsLog.id, id));
}
