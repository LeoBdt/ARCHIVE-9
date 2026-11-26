import { randomUUID } from "node:crypto";
import { planDossierTidy } from "@archive-9/ai";
import { fragmentCode } from "@archive-9/core";
import {
  createCategory,
  deleteFact,
  dossierFacts,
  listCategories,
  lookalikePairs,
  markTidied,
  MAX_PERSONAL_CATEGORIES,
  memberNames,
  mergeFacts,
  moveFacts,
  notify,
  participantProfiles,
  recordAiUsage,
  recordFactOperation,
  rewriteFact,
  semanticPairs,
  vectorStoreReady,
  type FactOpRun,
} from "@archive-9/db";
import type { LearningDeps } from "./analyse.ts";

export interface TidyReport {
  dossiers: number;
  done: number;
  planned: number;
  costUsd: number;
}

/**
 * Rereads one dossier and cleans it: duplicates merged, noise deleted, wording fixed,
 * fragments moved, personal drawers opened. In dry run, merges and deletions only wait for
 * an admin. Every operation is logged in `fact_operations`.
 */
export async function tidyDossier(deps: LearningDeps, memberId: string, run: FactOpRun): Promise<{ done: number; planned: number; costUsd: number }> {
  const { db, ai, log } = deps;
  const facts = await dossierFacts(db, memberId);
  const report = { done: 0, planned: 0, costUsd: 0 };
  if (facts.length < 2) {
    await markTidied(db, memberId);
    return report;
  }
  const [[person], drawers, lexical, reporterNames] = await Promise.all([
    participantProfiles(db, [memberId], 0),
    listCategories(db, memberId),
    lookalikePairs(db, memberId),
    memberNames(db, [...new Set(facts.flatMap((f) => (f.reportedBy ? [f.reportedBy] : [])))]),
  ]);
  if (!person) return report;
  const semantic = (await vectorStoreReady(db)) ? await semanticPairs(db, memberId) : [];
  const counts = new Map<string, number>();
  for (const f of facts) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const pairs = new Map([...lexical, ...semantic].map(([a, b]) => [`${a}:${b}`, [a, b] as [string, string]]));

  const outcome = await planDossierTidy(ai, {
    name: person.name,
    isServer: person.isServer,
    summary: person.summary,
    facts: facts.map((f) => ({ ...f, reportedByName: f.reportedBy ? (reporterNames.get(f.reportedBy) ?? null) : null })),
    drawers: drawers.map((d) => ({ key: d.key, label: d.label, personal: d.memberId !== null, count: counts.get(d.key) ?? 0 })),
    room: Math.max(0, MAX_PERSONAL_CATEGORIES - drawers.filter((d) => d.memberId !== null).length),
    lookalikes: [...pairs.values()],
    timezone: deps.timezone,
  });
  report.costUsd = outcome.usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
  await recordAiUsage(db, outcome.usage.map((u) => ({ ...u, runId: randomUUID(), detail: `rangement ${person.name}` })));
  if (!outcome.plan) return report;

  const plan = outcome.plan;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const label = (id: string) => {
    const f = byId.get(id);
    return f ? { ref: f.ref, content: f.content } : { ref: "?", content: "" };
  };
  const dryRun = deps.tidyDryRun();
  const op = (input: Parameters<typeof recordFactOperation>[1]) => recordFactOperation(db, input);

  for (const d of plan.drawers) {
    const created = await createCategory(db, { label: d.label, reason: d.why, factIds: d.factIds, memberId });
    if (!created.ok) {
      log.info({ memberId, label: d.label, reason: created.reason }, "personal drawer refused");
      continue;
    }
    await op({ memberId, factId: null, op: "drawer", status: "done", reason: d.why, details: { drawer: { key: created.key, label: d.label }, merged: d.factIds.map((id) => ({ id, ...label(id) })) }, run });
    report.done += 1;
  }
  for (const m of plan.moves) {
    const moved = await moveFacts(db, [m.factId], m.to);
    if (!moved) continue;
    await op({ memberId, factId: m.factId, op: "move", status: "done", reason: m.why, details: { from: byId.get(m.factId)?.category ?? "", to: m.to }, run });
    report.done += 1;
  }
  for (const r of plan.rewrites) {
    const newId = await rewriteFact(db, r.factId, r.content);
    if (!newId) continue;
    await op({ memberId, factId: newId, op: "rewrite", status: "done", reason: r.why, details: { before: byId.get(r.factId)?.content ?? "", after: r.content }, run });
    report.done += 1;
  }
  for (const m of plan.merges) {
    const merged = m.removeIds.map((id) => ({ id, ...label(id) }));
    const details = { before: byId.get(m.keepId)?.content ?? "", after: m.content ?? byId.get(m.keepId)?.content ?? "", merged };
    if (dryRun) {
      await op({ memberId, factId: m.keepId, op: "merge", status: "planned", reason: m.why, details, run });
      report.planned += 1;
      continue;
    }
    const newId = await mergeFacts(db, m.keepId, m.removeIds, m.content, "archive-9");
    if (!newId) continue;
    await op({ memberId, factId: newId, op: "merge", status: "done", reason: m.why, details, run });
    report.done += 1;
  }
  for (const d of plan.deletes) {
    const details = { before: byId.get(d.factId)?.content ?? "" };
    if (dryRun) {
      await op({ memberId, factId: d.factId, op: "delete", status: "planned", reason: d.why, details, run });
      report.planned += 1;
      continue;
    }
    if (!(await deleteFact(db, d.factId, "archive-9"))) continue;
    await op({ memberId, factId: d.factId, op: "delete", status: "done", reason: d.why, details, run });
    report.done += 1;
  }
  await markTidied(db, memberId);
  if (report.done || report.planned) {
    log.info({ memberId, done: report.done, planned: report.planned, first: facts[0] ? fragmentCode(facts[0].rank) : null }, "dossier tidied");
  }
  return report;
}

/** Tidies several dossiers one after the other, within a budget. */
export async function tidyDossiers(deps: LearningDeps, memberIds: string[], run: FactOpRun, budgetUsd: number, onDossier?: (done: number, total: number) => Promise<void>): Promise<TidyReport> {
  const report: TidyReport = { dossiers: 0, done: 0, planned: 0, costUsd: 0 };
  for (const memberId of memberIds) {
    if (report.costUsd >= budgetUsd) break;
    try {
      const one = await tidyDossier(deps, memberId, run);
      report.dossiers += 1;
      report.done += one.done;
      report.planned += one.planned;
      report.costUsd += one.costUsd;
    } catch (err) {
      deps.log.warn({ err, memberId }, "dossier tidy failed");
    }
    await onDossier?.(report.dossiers, memberIds.length);
  }
  if (report.done || report.planned) await notify(deps.db, { type: "learned" });
  return report;
}
