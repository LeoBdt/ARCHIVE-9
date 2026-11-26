import { randomUUID } from "node:crypto";
import { checkSkill, INITIAL_SELF_STATE, reflect, type SelfSkill } from "@archive-9/ai";
import { applySelfStateChange, checkSkillDraft, groupConversations, SELF_STATE_LIMITS, SKILL_LIMITS } from "@archive-9/core";
import {
  activeSkills,
  addNotes,
  notebookForReflection,
  applyAnalysis,
  createSkill,
  difficultiesSince,
  findActiveSkill,
  skillCounts,
  currentSelfState,
  factsSince,
  lastReflectionAt,
  markFeedbackVerdicts,
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
 * Picks up to `max` messages of conversations, oldest first. The daily ones favour those
 * ARCHIVE-9 took part in; the awakening favours the ones that made people react.
 */
function pickConversations(messages: StoredMessage[], max: number, mode: Mode): StoredMessage[][] {
  const score = (c: StoredMessage[]) =>
    mode !== "awakening" ? Number(c.some((m) => m.isSelf)) * 10_000 + c.length : reactionCount(c) * 3 + c.length;
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
  midday: { maxMessages: 100, facts: 15, limits: { ...SELF_STATE_LIMITS, changesPerList: 1 }, source: "midday" },
  // Not counted as the daily reflection, so the evening one still happens.
  awakening: { maxMessages: 400, facts: 60, limits: { ...SELF_STATE_LIMITS, changesPerList: 5 }, source: "initial" },
} as const;

type Mode = keyof typeof MODES;

async function reflectOn(deps: LearningDeps, mode: Mode, since: Date, keepSelfState = false): Promise<boolean> {
  const { db, ai, log, selfId } = deps;
  const config = MODES[mode];
  const messages = await messagesSince(db, selfId, since, 20_000);
  if (messages.length === 0) {
    log.info({ mode }, "nothing to reflect on");
    return false;
  }

  const [server, state, learned, changes, feedback, difficulties, skills, notebook] = await Promise.all([
    loadServerContext(db, deps.server),
    currentSelfState(db, INITIAL_SELF_STATE),
    factsSince(db, since, config.facts),
    mode !== "awakening" ? relationshipEventsSince(db, since, 30) : Promise.resolve([]),
    mode === "evening" ? pendingFeedback(db) : Promise.resolve([]),
    mode === "evening" ? difficultiesSince(db, since) : Promise.resolve([]),
    mode === "evening" ? activeSkills(db) : Promise.resolve([]),
    mode === "evening" ? notebookForReflection(db) : Promise.resolve([]),
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
    feedback: feedback.map((f) => ({ name: f.authorName, trust: f.trust, content: f.content, about: f.about })),
    difficulties,
    skills: skills.map((k) => ({ name: k.name, rule: k.rule })),
    notebook,
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
  const next = { ...applySelfStateChange(state, outcome.change, config.limits), icon: outcome.icon ?? state.icon };
  const { version, label } = await saveSelfState(db, next, config.source, mode === "awakening" ? "backfill" : null);
  if (mode === "evening") {
    // Weighed tonight: from now on they live on as resolutions, not as raw feedback.
    const verdictOf = new Map(outcome.verdicts.map((v) => [v.n, v]));
    await markFeedbackVerdicts(
      db,
      feedback.map((f, i) => ({ id: f.id, verdict: verdictOf.get(i + 1)?.verdict ?? null, reason: verdictOf.get(i + 1)?.why ?? null })),
      label,
    );
  }
  if (mode === "evening") {
    await addNotes(db, outcome.notes, label);
    if (outcome.newSkill) await giveItselfSkill(deps, outcome.newSkill);
  }
  await notify(db, { type: "self_state", version });
  log.info({ mode, version, label, mood: next.mood }, "reflection saved");
  if (next.icon && deps.onFace) {
    await deps.onFace(next.icon).catch((err: unknown) => {
      log.warn({ err }, "face not shown on Discord");
    });
  }
  return true;
}

/** A skill it decided to give itself: the same checks as a member's, with itself as author. */
async function giveItselfSkill(deps: LearningDeps, skill: SelfSkill): Promise<void> {
  const { db, ai, log, selfId } = deps;
  const check = checkSkillDraft({ name: skill.name, kind: skill.kind, triggers: skill.triggers, rule: skill.rule });
  if (!check.ok) {
    log.info({ name: skill.name, reason: check.reason }, "own skill refused");
    return;
  }
  const counts = await skillCounts(db, selfId);
  if (counts.byAuthor >= SKILL_LIMITS.perMember || counts.total >= SKILL_LIMITS.total) return;
  if (check.draft.kind === "permanent" && counts.permanent >= SKILL_LIMITS.permanent) return;
  if (await findActiveSkill(db, check.draft.name)) return;
  const { verdict, usage } = await checkSkill(ai, check.draft);
  await recordAiUsage(db, usage.map((u) => ({ ...u, runId: randomUUID(), detail: `vérification de skill : ${verdict.ok ? "acceptée" : verdict.reason}` })));
  if (!verdict.ok) return;
  const id = await createSkill(db, check.draft, selfId);
  if (id) log.info({ skillId: id, name: check.draft.name, why: skill.why }, "gave itself a skill");
}

/** The big evening reflection, over the last 24 hours. Returns false when nothing happened. */
export async function runReflection(deps: LearningDeps): Promise<boolean> {
  return reflectOn(deps, "evening", new Date(Date.now() - DAY));
}

/** The light midday one, over what happened since the last reflection (14 hours at most). */
export async function runMiddayReflection(deps: LearningDeps): Promise<boolean> {
  const last = await lastReflectionAt(deps.db);
  const floor = Date.now() - 14 * 60 * 60_000;
  return reflectOn(deps, "midday", new Date(Math.max(floor, last?.getTime() ?? 0)));
}

/**
 * A first self state built from a whole history, after a backfill. With `serverOnly`, the
 * history only feeds the server's profile and the self state is left as it is.
 */
export async function runAwakening(deps: LearningDeps, since: Date, options: { serverOnly?: boolean } = {}): Promise<boolean> {
  return reflectOn(deps, "awakening", since, options.serverOnly);
}
