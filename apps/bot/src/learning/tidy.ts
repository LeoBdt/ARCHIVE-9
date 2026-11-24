import { randomUUID } from "node:crypto";
import { planTidy } from "@archive-9/ai";
import { categoryCounts, createCategory, factsInCategory, listCategories, MAX_CATEGORIES, moveFacts, notify, recordAiUsage } from "@archive-9/db";
import type { LearningDeps } from "./analyse.ts";

const LOOSE_FACTS = 150;

/**
 * Looks at the facts left in « Divers » and files them better: in an existing drawer, or
 * in a new one when several share a theme. The code has the last word on every drawer.
 */
export async function tidyDrawers(deps: LearningDeps): Promise<{ created: string[]; moved: number }> {
  const { db, ai, log } = deps;
  const loose = await factsInCategory(db, "other", LOOSE_FACTS);
  if (loose.length < 3) return { created: [], moved: 0 };
  const [categories, counts] = await Promise.all([listCategories(db), categoryCounts(db)]);
  const refs = new Map(loose.map((f, i) => [`F${String(i + 1)}`, f]));
  const outcome = await planTidy(ai, {
    categories: categories.map((c) => ({ key: c.key, label: c.label, count: counts.get(c.key) ?? 0 })),
    facts: [...refs].map(([ref, f]) => ({ ref, category: f.category, content: f.content })),
    room: MAX_CATEGORIES - categories.length,
  });
  await recordAiUsage(db, outcome.usage.map((u) => ({ ...u, runId: randomUUID(), detail: "rangement des tiroirs" })));
  if (!outcome.value) return { created: [], moved: 0 };

  const created: string[] = [];
  const taken = new Set<string>();
  for (const drawer of outcome.value.create) {
    const ids = drawer.refs.flatMap((r) => (refs.get(r) ? [refs.get(r)?.id ?? ""] : []));
    const result = await createCategory(db, { label: drawer.label, reason: drawer.why, factIds: ids });
    if (result.ok) {
      created.push(drawer.label);
      for (const r of drawer.refs) taken.add(r);
    } else log.info({ label: drawer.label, reason: result.reason }, "drawer refused");
  }
  let moved = 0;
  const byTarget = new Map<string, string[]>();
  for (const m of outcome.value.moves) {
    const fact = refs.get(m.ref);
    if (!fact || taken.has(m.ref) || m.to === "other") continue;
    byTarget.set(m.to, [...(byTarget.get(m.to) ?? []), fact.id]);
  }
  for (const [key, ids] of byTarget) moved += await moveFacts(db, ids, key);
  if (created.length || moved) {
    await notify(db, { type: "learned" });
    log.info({ created, moved }, "drawers tidied");
  }
  return { created, moved };
}
