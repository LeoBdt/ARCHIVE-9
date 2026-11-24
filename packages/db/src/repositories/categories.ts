import { BASE_CATEGORY_INFO, NEW_CATEGORY_COLORS, normaliseName, type CategoryInfo } from "@archive-9/core";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { factCategories, profileFacts } from "../schema.ts";

/** A drawer can't be opened past this. */
export const MAX_CATEGORIES = 24;
/** A new drawer needs at least this many facts to start with. */
export const MIN_FACTS_FOR_CATEGORY = 3;

export async function listCategories(db: Database): Promise<(CategoryInfo & { createdBy: string; reason: string | null; createdAt: Date })[]> {
  return db.select().from(factCategories).orderBy(asc(factCategories.createdAt), asc(factCategories.key));
}

/** How many current facts each drawer holds. */
export async function categoryCounts(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ key: profileFacts.category, n: count() })
    .from(profileFacts)
    .where(and(isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt)))
    .groupBy(profileFacts.category);
  return new Map(rows.map((r) => [r.key, r.n]));
}

/** `cuisine-maison` from « Cuisine maison ». */
export function categoryKey(label: string): string {
  return normaliseName(label).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

export type CategoryRefusal = "full" | "exists" | "too_few" | "bad_label";

/**
 * Opens a new drawer and files these facts in it, all or nothing. The code decides: a
 * readable label, no twin of an existing drawer, enough facts, and a cap on the total.
 */
export async function createCategory(
  db: Database,
  input: { label: string; reason: string; factIds: string[] },
): Promise<{ ok: true; key: string } | { ok: false; reason: CategoryRefusal }> {
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, 32);
  const key = categoryKey(label);
  if (key.length < 3) return { ok: false, reason: "bad_label" };
  return db.transaction(async (tx) => {
    const existing = await tx.select({ key: factCategories.key, label: factCategories.label }).from(factCategories);
    if (existing.length >= MAX_CATEGORIES) return { ok: false, reason: "full" as const };
    if (existing.some((c) => c.key === key || categoryKey(c.label) === key)) return { ok: false, reason: "exists" as const };
    const facts = input.factIds.length
      ? await tx
          .select({ id: profileFacts.id })
          .from(profileFacts)
          .where(and(inArray(profileFacts.id, input.factIds), isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt)))
      : [];
    if (facts.length < MIN_FACTS_FOR_CATEGORY) return { ok: false, reason: "too_few" as const };
    const own = existing.length - Object.keys(BASE_CATEGORY_INFO).length;
    const color = NEW_CATEGORY_COLORS[Math.max(0, own) % NEW_CATEGORY_COLORS.length] ?? "#e6a1ff";
    await tx.insert(factCategories).values({ key, label, color, createdBy: "archive-9", reason: input.reason.slice(0, 300) });
    await tx
      .update(profileFacts)
      .set({ category: key, updatedAt: sql`now()` })
      .where(inArray(profileFacts.id, facts.map((f) => f.id)));
    return { ok: true as const, key };
  });
}

/** Files current facts in another existing drawer. Returns how many moved. */
export async function moveFacts(db: Database, factIds: string[], key: string): Promise<number> {
  if (factIds.length === 0) return 0;
  const [target] = await db.select({ key: factCategories.key }).from(factCategories).where(eq(factCategories.key, key));
  if (!target) return 0;
  const rows = await db
    .update(profileFacts)
    .set({ category: key, updatedAt: sql`now()` })
    .where(and(inArray(profileFacts.id, factIds), isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt)))
    .returning({ id: profileFacts.id });
  return rows.length;
}

/** Current facts filed in a drawer, newest first. */
export async function factsInCategory(db: Database, key: string, limit: number) {
  return db
    .select({ id: profileFacts.id, memberId: profileFacts.memberId, category: profileFacts.category, content: profileFacts.content })
    .from(profileFacts)
    .where(and(eq(profileFacts.category, key), isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt)))
    .orderBy(sql`${profileFacts.createdAt} desc`)
    .limit(limit);
}
