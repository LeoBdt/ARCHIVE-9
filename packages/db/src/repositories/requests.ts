import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { siteRequests, type RequestStep } from "../schema.ts";

export const REQUEST_KINDS = ["fact_edit", "fact_remove", "mind_comment", "skill_create", "skill_edit"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Requests one person may send from the site in 24 hours. */
export const REQUESTS_PER_DAY = 30;
/** Requests ARCHIVE-9 spends AI on in 24 hours, for everyone. Past it, edits still apply. */
export const AI_REQUESTS_PER_DAY = 200;

export type SiteRequest = typeof siteRequests.$inferSelect;

/** Queues a request for the bot. Null when the person sent too many today. */
export async function createSiteRequest(
  db: Database,
  input: { kind: RequestKind; requesterId: string; targetId: string | null; payload: Record<string, unknown>; firstStep: string },
): Promise<string | null> {
  const [row] = await db
    .select({ n: count() })
    .from(siteRequests)
    .where(and(eq(siteRequests.requesterId, input.requesterId), gte(siteRequests.createdAt, sql`now() - interval '1 day'`)));
  if ((row?.n ?? 0) >= REQUESTS_PER_DAY) return null;
  const steps: RequestStep[] = [{ at: new Date().toISOString(), kind: "step", text: input.firstStep }];
  const [created] = await db
    .insert(siteRequests)
    .values({ kind: input.kind, requesterId: input.requesterId, targetId: input.targetId, payload: input.payload, steps })
    .returning({ id: siteRequests.id });
  return created?.id ?? null;
}

export async function getSiteRequest(db: Database, id: string): Promise<SiteRequest | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await db.select().from(siteRequests).where(eq(siteRequests.id, id));
  return row;
}

/** Takes every pending request at once, oldest first, so two of them never run twice. */
export async function claimRequests(db: Database, limit = 20): Promise<SiteRequest[]> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({ id: siteRequests.id })
      .from(siteRequests)
      .where(eq(siteRequests.status, "pending"))
      .orderBy(asc(siteRequests.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (pending.length === 0) return [];
    return tx
      .update(siteRequests)
      .set({ status: "running" })
      .where(inArray(siteRequests.id, pending.map((p) => p.id)))
      .returning();
  });
}

/** Requests left running by a restart go back in the queue. */
export async function requeueStale(db: Database): Promise<void> {
  await db.update(siteRequests).set({ status: "pending" }).where(eq(siteRequests.status, "running"));
}

export async function addRequestStep(db: Database, id: string, kind: RequestStep["kind"], text: string): Promise<void> {
  const step = JSON.stringify([{ at: new Date().toISOString(), kind, text }]);
  await db
    .update(siteRequests)
    .set({ steps: sql`${siteRequests.steps} || ${step}::jsonb` })
    .where(eq(siteRequests.id, id));
}

export async function finishRequest(db: Database, id: string, status: "done" | "failed", result: Record<string, unknown>, costUsd: number): Promise<void> {
  await db.update(siteRequests).set({ status, result, costUsd, finishedAt: sql`now()` }).where(eq(siteRequests.id, id));
}

/** How many requests used the AI in the last 24 hours. */
export async function aiRequestsToday(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(siteRequests)
    .where(and(gte(siteRequests.createdAt, sql`now() - interval '1 day'`), sql`${siteRequests.costUsd} > 0`));
  return row?.n ?? 0;
}

/** Latest requests of a person, for the site to pick up one still running. */
export async function recentRequests(db: Database, requesterId: string, limit = 10): Promise<SiteRequest[]> {
  return db.select().from(siteRequests).where(eq(siteRequests.requesterId, requesterId)).orderBy(desc(siteRequests.createdAt)).limit(limit);
}
