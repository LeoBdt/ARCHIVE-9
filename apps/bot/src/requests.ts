import { answerMindComment, checkSkill, INITIAL_SELF_STATE, planCorrection, planSkill, type UsageRecord } from "@archive-9/ai";
import { checkSkillDraft, parseUntil, SKILL_LIMITS, truncate } from "@archive-9/core";
import {
  addFeedback,
  addRequestStep,
  AI_REQUESTS_PER_DAY,
  aiRequestsToday,
  applyAnalysis,
  claimRequests,
  createSkill,
  currentFacts,
  findActiveSkill,
  finishRequest,
  getSkill,
  latestSelfState,
  listCategories,
  memberNames,
  notify,
  recordAiUsage,
  requeueStale,
  skillCounts,
  updateSkill,
  type SiteRequest,
  type SqlClient,
} from "@archive-9/db";
import { refreshSummaries, type LearningDeps } from "./learning/analyse.ts";
import type { SettingsStore } from "./settings.ts";

export interface RequestDeps extends LearningDeps {
  client: SqlClient;
  settings: SettingsStore;
}

const POLL_MS = 30_000;
/** Edits of one dossier sent close together are read together. */
const GATHER_MS = 3_000;

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const costOf = (usage: UsageRecord[]) => usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);

/** Handles what members ask from the site, step by step, so the page can follow along. */
export function startRequestWorker(deps: RequestDeps): () => void {
  const { db, log } = deps;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      for (;;) {
        const batch = await claimRequests(db);
        if (batch.length === 0) break;
        const refresh = new Set<string>();
        for (const request of batch) {
          await handle(deps, request, refresh).catch(async (err: unknown) => {
            log.error({ err, requestId: request.id }, "site request failed");
            await addRequestStep(db, request.id, "error", "Quelque chose a planté de mon côté. Rien n'est perdu : ce qui était enregistré le reste.");
            await finishRequest(db, request.id, "failed", { error: String(err) }, 0);
          });
        }
        if (refresh.size) await notify(db, { type: "learned" });
      }
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), GATHER_MS);
  };

  void requeueStale(db).then(schedule);
  void deps.client.listen("archive9", (payload) => {
    if (payload.includes('"site_requests"')) schedule();
  });
  const interval = setInterval(schedule, POLL_MS);
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
  };
}

async function handle(deps: RequestDeps, request: SiteRequest, refresh: Set<string>): Promise<void> {
  // Only steps it hasn't written yet get added: a request picked up again after a restart resumes.
  if (request.steps.some((s) => s.kind === "say")) {
    await finishRequest(deps.db, request.id, "done", request.result ?? {}, request.costUsd ?? 0);
    return;
  }
  switch (request.kind) {
    case "fact_edit":
    case "fact_remove":
      return followCorrection(deps, request, refresh);
    case "mind_comment":
      return answerComment(deps, request);
    case "skill_create":
    case "skill_edit":
      return learnSkill(deps, request);
    default:
      await finishRequest(deps.db, request.id, "failed", { error: "unknown kind" }, 0);
  }
}

async function saveUsage(deps: RequestDeps, request: SiteRequest, usage: UsageRecord[]): Promise<number> {
  await recordAiUsage(deps.db, usage.map((u) => ({ ...u, runId: request.id, detail: `site : ${request.kind}` })));
  return costOf(usage);
}

/** A fragment was corrected or removed on the site: apply what follows from it, then say so. */
async function followCorrection(deps: RequestDeps, request: SiteRequest, refresh: Set<string>): Promise<void> {
  const { db, ai } = deps;
  const step = (t: string) => addRequestStep(db, request.id, "step", t);
  const p = request.payload;
  const memberId = text(p.memberId);
  const [names, facts, categories] = await Promise.all([memberNames(db, [memberId]), currentFacts(db, memberId, 80), listCategories(db)]);
  const name = names.get(memberId) ?? "ce membre";
  const others = facts.filter((f) => f.id !== text(p.newFactId));

  if ((await aiRequestsToday(db)) >= AI_REQUESTS_PER_DAY) {
    await step("Ta correction est enregistrée. J'ai assez réfléchi pour aujourd'hui : je relirai le reste du dossier à la prochaine analyse.");
    await finishRequest(db, request.id, "done", {}, 0);
    return;
  }
  await step(`Je relis les ${String(others.length)} autres fragments du dossier de ${name}.`);
  const refs = new Map(others.map((f, i) => [`F${String(i + 1)}`, f]));
  const outcome = await planCorrection(ai, {
    name,
    editorName: text(p.editorName),
    byOwner: p.byOwner === true,
    before: text(p.before),
    after: request.kind === "fact_edit" ? text(p.after) : null,
    reason: text(p.reason),
    facts: [...refs].map(([ref, f]) => ({ ref, category: f.category, content: f.content })),
    categories: categories.map((c) => ({ key: c.key, label: c.label })),
  });
  let cost = await saveUsage(deps, request, outcome.usage);
  if (!outcome.value) {
    await addRequestStep(db, request.id, "error", "Mes modèles ne répondent pas. Ta correction reste enregistrée ; je relirai le dossier plus tard.");
    await finishRequest(db, request.id, "failed", {}, cost);
    return;
  }
  const plan = outcome.value;
  const retractions = plan.retract.flatMap((r) => {
    const fact = refs.get(r.ref);
    return fact ? [{ factId: fact.id, memberId, content: fact.content, why: r.why }] : [];
  });
  await applyAnalysis(db, {
    facts: plan.add.map((f) => ({
      memberId,
      category: f.category,
      nature: p.byOwner === true ? "fact" : "reported",
      confidence: 0.8,
      content: f.content,
      sourceMessageIds: [],
      reportedBy: p.byOwner === true ? null : request.requesterId,
      replacesId: null,
    })),
    retractions,
    relationships: [],
    analysedIds: [],
    at: new Date(),
  });
  for (const r of retractions) await step(`Retiré : « ${truncate(r.content, 90)} ». ${r.why}`);
  for (const f of plan.add) await step(`Nouveau fragment : « ${f.content} »`);
  if (retractions.length === 0 && plan.add.length === 0) await step("Rien d'autre à changer dans le dossier.");

  const before = await currentSummaryLine(deps, memberId);
  const report = { costUsd: 0 };
  await refreshSummaries(deps, [memberId], report);
  cost += report.costUsd;
  refresh.add(memberId);
  const after = await currentSummaryLine(deps, memberId);
  await step(before === after ? "Résumé du dossier relu : la phrase ne change pas." : "Résumé et phrase du dossier réécrits.");
  await addRequestStep(db, request.id, "say", plan.say);
  await finishRequest(db, request.id, "done", { retracted: retractions.length, added: plan.add.length }, cost);
}

async function currentSummaryLine(deps: RequestDeps, memberId: string): Promise<string | null> {
  const rows = await deps.client<{ tagline: string | null }[]>`select tagline from profile_summaries where member_id = ${memberId}`;
  return rows[0]?.tagline ?? null;
}

/** An admin commented on its mind: it answers now and weighs it in the evening. */
async function answerComment(deps: RequestDeps, request: SiteRequest): Promise<void> {
  const { db, ai } = deps;
  const p = request.payload;
  await addRequestStep(db, request.id, "step", `Je relis « ${truncate(text(p.about), 80)} » et mon état du moment.`);
  const state = (await latestSelfState(db)) ?? INITIAL_SELF_STATE;
  const outcome = await answerMindComment(ai, { authorName: text(p.authorName), about: text(p.about), comment: text(p.comment), state });
  const cost = await saveUsage(deps, request, outcome.usage);
  if (!outcome.value) {
    await addRequestStep(db, request.id, "error", "Mes modèles ne répondent pas. Ton commentaire est gardé quand même pour ce soir.");
  } else {
    await addRequestStep(db, request.id, "say", outcome.value);
  }
  const kept = await addFeedback(db, request.requesterId, text(p.comment), null, { source: "site", about: text(p.about) });
  const hour = String(deps.settings.value.reflectionHours.evening).padStart(2, "0");
  await addRequestStep(db, request.id, "step", kept ? `Gardé pour ma réflexion de ${hour}:00.` : "Tu m'as déjà fait beaucoup de retours aujourd'hui : celui-ci n'est pas gardé.");
  await finishRequest(db, request.id, outcome.value ? "done" : "failed", {}, cost);
}

/** A skill taught or edited from the site: it picks the type, the code checks, then it explains. */
async function learnSkill(deps: RequestDeps, request: SiteRequest): Promise<void> {
  const { db, ai, settings } = deps;
  const step = (t: string) => addRequestStep(db, request.id, "step", t);
  const fail = async (t: string, cost: number) => {
    await addRequestStep(db, request.id, "error", t);
    await finishRequest(db, request.id, "failed", {}, cost);
  };
  const p = request.payload;
  const editing = request.kind === "skill_edit";
  const current = editing ? await getSkill(db, text(p.skillId)) : undefined;
  if (editing && !current) return fail("Cette skill n'existe plus.", 0);
  const channels = settings.value.channelDirectory;
  const channelName = (id: string | null) => (id ? (channels.find((c) => c.id === id)?.name ?? null) : null);
  const requester = (await memberNames(db, [request.requesterId])).get(request.requesterId) ?? "quelqu'un";

  await step("Je lis ta demande et je choisis le type de skill.");
  const outcome = await planSkill(ai, {
    requesterName: requester,
    text: text(p.text),
    now: new Date(),
    timezone: deps.timezone,
    channels: channels.map((c) => c.name),
    current: current
      ? {
          name: current.name,
          kind: current.kind,
          triggers: current.triggers,
          rule: current.rule,
          channel: channelName(current.channelId),
          member: current.memberId ? ((await memberNames(db, [current.memberId])).get(current.memberId) ?? null) : null,
        }
      : undefined,
  });
  let cost = await saveUsage(deps, request, outcome.usage);
  const plan = outcome.value;
  if (!plan) return fail("Mes modèles ne répondent pas, réessaie un peu plus tard.", cost);
  if (!plan.accept) {
    await addRequestStep(db, request.id, "say", plan.refusal || "Je ne vois pas de consigne à retenir là-dedans.");
    return fail("Pas de skill créée.", cost);
  }

  const channel = plan.channel ? channels.find((c) => c.name.toLowerCase() === plan.channel?.replace(/^#/, "").toLowerCase()) : undefined;
  const kindLabel = plan.kind === "triggered" ? `déclenchée par des mots (${plan.triggers.join(", ")})` : "toujours active";
  const scope = channel ? `seulement dans #${channel.name}` : plan.onlyRequester ? `seulement avec ${requester}` : "tout le serveur";
  await step(`Type : ${kindLabel}. Portée : ${scope}.`);

  const check = checkSkillDraft({
    name: plan.name,
    kind: plan.kind,
    triggers: plan.triggers,
    rule: plan.rule,
    channelId: channel?.id ?? null,
    memberId: plan.onlyRequester ? request.requesterId : null,
  });
  if (!check.ok) return fail(`Refusée par le code : ${check.reason}.`, cost);
  const expiresAt = plan.until ? parseUntil(plan.until, deps.timezone, new Date()) : null;
  if (plan.until && !expiresAt) return fail("Refusée par le code : heure de fin illisible, passée ou à plus d'une semaine.", cost);

  if (!editing) {
    const counts = await skillCounts(db, request.requesterId);
    if (counts.byAuthor >= SKILL_LIMITS.perMember) return fail(`Refusée : ${String(SKILL_LIMITS.perMember)} skills par personne au maximum.`, cost);
    if (counts.total >= SKILL_LIMITS.total) return fail(`Refusée : le serveur a déjà ${String(SKILL_LIMITS.total)} skills.`, cost);
    if (check.draft.kind === "permanent" && counts.permanent >= SKILL_LIMITS.permanent) {
      return fail(`Refusée : déjà ${String(SKILL_LIMITS.permanent)} skills toujours actives.`, cost);
    }
    if (await findActiveSkill(db, check.draft.name)) return fail("Refusée : une skill porte déjà ce nom.", cost);
    await step(`Limites : tu en as ${String(counts.byAuthor)} sur ${String(SKILL_LIMITS.perMember)}, le serveur ${String(counts.total)} sur ${String(SKILL_LIMITS.total)}.`);
  } else if (current) {
    await step(`Avant : ${truncate(current.rule, 140)}`);
  }

  const safety = await checkSkill(ai, check.draft);
  cost += await saveUsage(deps, request, safety.usage);
  if (!safety.verdict.ok) {
    await step(`Sécurité : refusée, ${safety.verdict.reason}.`);
    await addRequestStep(db, request.id, "say", `Je ne peux pas apprendre ça : ${safety.verdict.reason}.`);
    await finishRequest(db, request.id, "failed", {}, cost);
    return;
  }
  await step("Sécurité : rien de dangereux.");

  if (editing && current) {
    const saved = await updateSkill(db, current.id, check.draft, expiresAt, request.requesterId);
    if (saved !== true) return fail(saved === false ? "Refusée : une autre skill porte déjà ce nom." : "Cette skill n'existe plus.", cost);
  } else {
    const id = await createSkill(db, check.draft, request.requesterId, expiresAt);
    if (!id) return fail("Refusée : une skill porte déjà ce nom.", cost);
  }
  await addRequestStep(db, request.id, "say", `${plan.understood} Exemple : ${plan.example}`);
  await step(editing ? `Modifiée. L'ancienne version reste dans l'historique.` : `Active sous le nom « ${check.draft.name} ».`);
  await finishRequest(db, request.id, "done", { name: check.draft.name }, cost);
}
