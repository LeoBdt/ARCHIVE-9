import { ANALYSIS_TIMING, dueReflection, type ReflectionHours } from "@archive-9/core";
import { aiCostSince, lastReflections, pendingStats, purgeDecisions, purgeMessages, summariesToRefresh, withAdvisoryLock, type SqlClient } from "@archive-9/db";
import { refreshSummaries, runAnalysis, type AnalysisReport, type LearningDeps } from "./analyse.ts";
import { runMiddayReflection, runReflection } from "./reflect.ts";
import { tidyDrawers } from "./tidy.ts";

export interface JobsConfig {
  analysisDailyBudgetUsd: number;
  /** Read at each tick: the site can change them. */
  reflectionHours: () => ReflectionHours;
  retentionDays: number;
}

/** Shared with the backfill script, so only one process analyses at a time. */
export const ANALYSIS_LOCK = 7_309_001;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TICK_MS = 5 * MINUTE;
const RETRY_MS = 60 * MINUTE;
const PURGE_EVERY_MS = 6 * 60 * MINUTE;

/** Runs analysis, reflection and purge in the background. Returns a function that stops them. */
export function startLearningJobs(deps: LearningDeps & { client: SqlClient }, config: JobsConfig): () => void {
  const { db, log, selfId } = deps;
  let running = false;
  let lastPurgeAt = 0;
  let analysisRetryAt = 0;
  let reflectionRetryAt = 0;

  async function analyseNow(includeOngoing: boolean): Promise<AnalysisReport | null> {
    if (Date.now() < analysisRetryAt) return null;
    const spent = await aiCostSince(db, ["analysis"], new Date(Date.now() - DAY));
    const budgetUsd = config.analysisDailyBudgetUsd - spent;
    if (budgetUsd <= 0) {
      log.warn({ spent }, "analysis budget spent for today");
      analysisRetryAt = Date.now() + RETRY_MS;
      return null;
    }
    const lock = await withAdvisoryLock(deps.client, ANALYSIS_LOCK, () => runAnalysis(deps, { budgetUsd, includeOngoing }));
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
        // What it decided about each message is only kept two weeks.
        await purgeDecisions(db, new Date(now.getTime() - 14 * DAY));
      }

      // Someone took facts off their profile: their summary must stop mentioning them.
      const corrected = await summariesToRefresh(db);
      if (corrected.length > 0) {
        const written = await refreshSummaries(deps, corrected, { costUsd: 0 });
        log.info({ members: corrected.length, written }, "summaries refreshed after corrections");
      }

      const stats = await pendingStats(db, selfId);
      const due = now.getTime() >= reflectionRetryAt ? dueReflection(now, await lastReflections(db), deps.timezone, config.reflectionHours()) : null;
      // Finished conversations are analysed right away. A very active member, or a
      // reflection, also pulls in the conversations still going on.
      if (stats.oldestAt) await analyseNow(stats.maxPerMember >= ANALYSIS_TIMING.memberThreshold || due !== null);

      if (due) {
        try {
          // Nothing happened: look again in an hour.
          const done = due === "evening" ? await runReflection(deps) : await runMiddayReflection(deps);
          if (!done) reflectionRetryAt = now.getTime() + RETRY_MS;
          if (done && due === "evening") {
            await tidyDrawers(deps).catch((err: unknown) => {
              log.warn({ err }, "drawer tidy failed");
            });
          }
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
