import { analysisDue, reflectionDue } from "@archive-9/core";
import { aiCostSince, lastReflectionAt, pendingMessages, pendingStats, purgeMessages, withAdvisoryLock, type SqlClient } from "@archive-9/db";
import { runAnalysis, type AnalysisReport, type LearningDeps } from "./analyse.ts";
import { runReflection } from "./reflect.ts";

export interface JobsConfig {
  analysisDailyBudgetUsd: number;
  reflectionHour: number;
  retentionDays: number;
}

/** Shared with the backfill script, so only one process analyses at a time. */
export const ANALYSIS_LOCK = 7_309_001;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TICK_MS = 5 * MINUTE;
const SETTLE_MS = 10 * MINUTE;
const RETRY_MS = 60 * MINUTE;
const PURGE_EVERY_MS = 6 * 60 * MINUTE;

/** Runs analysis, reflection and purge in the background. Returns a function that stops them. */
export function startLearningJobs(deps: LearningDeps & { client: SqlClient }, config: JobsConfig): () => void {
  const { db, log, selfId } = deps;
  let running = false;
  let lastPurgeAt = 0;
  let analysisRetryAt = 0;
  let reflectionRetryAt = 0;

  async function analyseNow(): Promise<AnalysisReport | null> {
    if (Date.now() < analysisRetryAt) return null;
    const spent = await aiCostSince(db, ["analysis"], new Date(Date.now() - DAY));
    const budgetUsd = config.analysisDailyBudgetUsd - spent;
    if (budgetUsd <= 0) {
      log.warn({ spent }, "analysis budget spent for today");
      analysisRetryAt = Date.now() + RETRY_MS;
      return null;
    }
    const lock = await withAdvisoryLock(deps.client, ANALYSIS_LOCK, () => runAnalysis(deps, { budgetUsd, settleMs: SETTLE_MS }));
    if (!lock.acquired) {
      log.info("analysis already running in another process");
      return null;
    }
    if (lock.value.failed) analysisRetryAt = Date.now() + RETRY_MS;
    return lock.value;
  }

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      if (now.getTime() - lastPurgeAt >= PURGE_EVERY_MS) {
        const purged = await purgeMessages(db, new Date(now.getTime() - config.retentionDays * DAY));
        lastPurgeAt = now.getTime();
        if (purged > 0) log.info({ purged }, "old messages purged");
      }

      const stats = await pendingStats(db, selfId);
      const reflectNow =
        now.getTime() >= reflectionRetryAt && reflectionDue(now, await lastReflectionAt(db), deps.timezone, config.reflectionHour);
      // Before reflecting, learn from the day's last conversations.
      const settled = stats.oldestAt !== null && (await pendingMessages(db, selfId, new Date(now.getTime() - SETTLE_MS), 1)).length > 0;
      if (settled && (analysisDue(stats, now) || reflectNow)) await analyseNow();

      if (reflectNow) {
        try {
          // Nothing happened today: look again in an hour.
          if (!(await runReflection(deps))) reflectionRetryAt = now.getTime() + RETRY_MS;
        } catch (error) {
          reflectionRetryAt = now.getTime() + RETRY_MS;
          throw error;
        }
      }
    } catch (error) {
      log.error({ err: error }, "learning job failed");
    } finally {
      running = false;
    }
  }

  const first = setTimeout(() => void tick(), MINUTE);
  const interval = setInterval(() => void tick(), TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
