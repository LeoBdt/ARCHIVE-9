import { randomUUID } from "node:crypto";
import { INITIAL_SELF_STATE, reflect } from "@archive-9/ai";
import { applySelfStateChange, groupConversations } from "@archive-9/core";
import {
  currentSelfState,
  factsSince,
  messagesSince,
  notify,
  recordAiUsage,
  relationshipEventsSince,
  saveSelfState,
  type StoredMessage,
} from "@archive-9/db";
import type { LearningDeps } from "./analyse.ts";

const DAY = 24 * 60 * 60_000;
const MAX_MESSAGES = 150;

/** Conversations ARCHIVE-9 took part in come first, then the rest while there is room. */
function pickConversations(messages: StoredMessage[]): StoredMessage[][] {
  const conversations = groupConversations(messages);
  const ranked = [...conversations].sort(
    (a, b) => Number(b.some((m) => m.isSelf)) - Number(a.some((m) => m.isSelf)) || b.length - a.length,
  );
  const picked: StoredMessage[][] = [];
  let size = 0;
  for (const conversation of ranked) {
    const room = MAX_MESSAGES - size;
    if (room <= 0) break;
    const kept = conversation.slice(-room);
    picked.push(kept);
    size += kept.length;
  }
  return picked.sort((a, b) => (a[0]?.createdAt.getTime() ?? 0) - (b[0]?.createdAt.getTime() ?? 0));
}

/** Rewrites ARCHIVE-9's self state from the last 24 hours. Returns false when nothing happened. */
export async function runReflection(deps: LearningDeps): Promise<boolean> {
  const { db, ai, log, selfId } = deps;
  const now = new Date();
  const since = new Date(now.getTime() - DAY);
  const messages = await messagesSince(db, selfId, since, 2_000);
  if (messages.length === 0) {
    log.info("nothing happened today, no reflection");
    return false;
  }

  const [state, learned, changes] = await Promise.all([
    currentSelfState(db, INITIAL_SELF_STATE),
    factsSince(db, since, 30),
    relationshipEventsSince(db, since, 30),
  ]);
  const outcome = await reflect(ai, {
    now,
    timezone: deps.timezone,
    state,
    conversations: pickConversations(messages).map((c) => ({
      channelName: c[0]?.guildId === null ? "message privé" : deps.channelName(c[0]?.channelId ?? ""),
      messages: c,
    })),
    learned: learned.map((f) => ({ name: f.memberName, nature: f.nature, content: f.content })),
    relationshipChanges: changes.map((r) => ({ name: r.memberName, affinityDelta: r.affinityDelta, trustDelta: r.trustDelta, reason: r.reason })),
  });
  const runId = randomUUID();
  await recordAiUsage(db, outcome.usage.map((record) => ({ ...record, runId })));
  if (!outcome.change) throw new Error("reflection produced no usable output");

  const next = applySelfStateChange(state, outcome.change);
  const version = await saveSelfState(db, next, "reflection", null);
  await notify(db, { type: "self_state", version });
  log.info({ version, mood: next.mood }, "reflection saved");
  return true;
}
