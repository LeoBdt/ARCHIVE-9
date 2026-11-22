import { randomUUID } from "node:crypto";
import { INITIAL_SELF_STATE, reflect } from "@archive-9/ai";
import { applySelfStateChange, groupConversations, SELF_STATE_LIMITS } from "@archive-9/core";
import {
  applyAnalysis,
  currentSelfState,
  factsSince,
  markFeedbackReviewed,
  memberNames,
  pendingFeedback,
  messagesSince,
  notify,
  recordAiUsage,
  relationshipEventsSince,
  saveSelfState,
  type StoredMessage,
} from "@archive-9/db";
import { refreshSummaries, type LearningDeps } from "./analyse.ts";
import { loadServerContext } from "./server.ts";

const DAY = 24 * 60 * 60_000;

function reactionCount(conversation: StoredMessage[]): number {
  return conversation.reduce((sum, m) => sum + Object.values(m.reactions).reduce((a, b) => a + b, 0), 0);
}

/**
 * Picks up to `max` messages of conversations, oldest first. The evening favours those
 * ARCHIVE-9 took part in; the awakening favours the ones that made people react.
 */
function pickConversations(messages: StoredMessage[], max: number, mode: "evening" | "awakening"): StoredMessage[][] {
  const score = (c: StoredMessage[]) =>
    mode === "evening" ? Number(c.some((m) => m.isSelf)) * 10_000 + c.length : reactionCount(c) * 3 + c.length;
  const ranked = [...groupConversations(messages)].sort((a, b) => score(b) - score(a));
  const picked: StoredMessage[][] = [];
  let size = 0;
  for (const conversation of ranked) {
    const room = max - size;
    if (room <= 0) break;
    const kept = conversation.slice(-room);
    picked.push(kept);
    size += kept.length;
  }
  return picked.sort((a, b) => (a[0]?.createdAt.getTime() ?? 0) - (b[0]?.createdAt.getTime() ?? 0));
}

const MODES = {
  evening: { maxMessages: 150, facts: 30, limits: SELF_STATE_LIMITS, source: "reflection" },
  // Not counted as the daily reflection, so the evening one still happens.
  awakening: { maxMessages: 400, facts: 60, limits: { ...SELF_STATE_LIMITS, changesPerList: 5 }, source: "initial" },
} as const;

async function reflectOn(deps: LearningDeps, mode: "evening" | "awakening", since: Date, keepSelfState = false): Promise<boolean> {
  const { db, ai, log, selfId } = deps;
  const config = MODES[mode];
  const messages = await messagesSince(db, selfId, since, 20_000);
  if (messages.length === 0) {
    log.info({ mode }, "nothing to reflect on");
    return false;
  }

  const [server, state, learned, changes, feedback] = await Promise.all([
    loadServerContext(db, deps.server),
    currentSelfState(db, INITIAL_SELF_STATE),
    factsSince(db, since, config.facts),
    mode === "evening" ? relationshipEventsSince(db, since, 30) : Promise.resolve([]),
    mode === "evening" ? pendingFeedback(db) : Promise.resolve([]),
  ]);
  const picked = pickConversations(messages, config.maxMessages, mode);
  const people = new Set(picked.flat().flatMap((m) => [m.authorId, ...m.mentionedIds]));
  const outcome = await reflect(ai, {
    mode,
    names: await memberNames(db, [...people]),
    now: new Date(),
    timezone: deps.timezone,
    server,
    state,
    conversations: picked.map((c) => ({
      channelName: c[0]?.guildId === null ? "message privé" : deps.channelName(c[0]?.channelId ?? ""),
      messages: c,
    })),
    learned: learned.map((f) => ({ name: f.memberName, nature: f.nature, content: f.content })),
    relationshipChanges: changes.map((r) => ({ name: r.memberName, affinityDelta: r.affinityDelta, trustDelta: r.trustDelta, reason: r.reason })),
    feedback: feedback.map((f) => ({ name: f.authorName, trust: f.trust, content: f.content })),
  });
  const runId = randomUUID();
  await recordAiUsage(db, outcome.usage.map((record) => ({ ...record, runId, detail: mode })));
  if (!outcome.change) throw new Error(`${mode} reflection produced no usable output`);

  if (server && outcome.serverFacts.length > 0) {
    await applyAnalysis(db, {
      facts: outcome.serverFacts.map((f) => ({ ...f, memberId: server.id, sourceMessageIds: [], reportedBy: null, replacesId: null })),
      retractions: [],
      relationships: [],
      analysedIds: [],
      at: new Date(),
    });
    const cost = { costUsd: 0 };
    await refreshSummaries(deps, [server.id], cost);
    log.info({ facts: outcome.serverFacts.length }, "server profile seeded");
  }

  if (keepSelfState) return true;
  const next = applySelfStateChange(state, outcome.change, config.limits);
  const version = await saveSelfState(db, next, config.source, mode === "awakening" ? "backfill" : null);
  // Weighed tonight: from now on they live on as resolutions, not as raw feedback.
  await markFeedbackReviewed(db, feedback.map((f) => f.id));
  await notify(db, { type: "self_state", version });
  log.info({ mode, version, mood: next.mood }, "reflection saved");
  return true;
}

/** Rewrites ARCHIVE-9's self state from the last 24 hours. Returns false when nothing happened. */
export async function runReflection(deps: LearningDeps): Promise<boolean> {
  return reflectOn(deps, "evening", new Date(Date.now() - DAY));
}

/**
 * A first self state built from a whole history, after a backfill. With `serverOnly`, the
 * history only feeds the server's profile and the self state is left as it is.
 */
export async function runAwakening(deps: LearningDeps, since: Date, options: { serverOnly?: boolean } = {}): Promise<boolean> {
  return reflectOn(deps, "awakening", since, options.serverOnly);
}
