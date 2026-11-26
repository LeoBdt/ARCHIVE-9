import { BASE_CATEGORY_INFO, NEW_CATEGORY_COLORS, normaliseName, type CategoryInfo } from "@archive-9/core";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { factCategories, profileFacts } from "../schema.ts";

/** Shared drawers can't go past this. */
export const MAX_CATEGORIES = 24;
/** Drawers made for one person, at most, in their dossier. */
export const MAX_PERSONAL_CATEGORIES = 6;
/** A new drawer needs at least this many facts to start with. */
export const MIN_FACTS_FOR_CATEGORY = 3;

export type DrawerRow = CategoryInfo & { memberId: string | null; createdBy: string; reason: string | null; createdAt: Date };

/** Shared drawers, plus this person's own when `memberId` is given, or every drawer with `"all"`. */
export async function listCategories(db: Database, memberId: string | null = null): Promise<DrawerRow[]> {
  const scope = memberId === "all" ? undefined : memberId ? or(isNull(factCategories.memberId), eq(factCategories.memberId, memberId)) : isNull(factCategories.memberId);
  return db.select().from(factCategories).where(scope).orderBy(asc(factCategories.createdAt), asc(factCategories.key));
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
  input: { label: string; reason: string; factIds: string[]; /** Only in this person's dossier. */ memberId?: string | null },
): Promise<{ ok: true; key: string } | { ok: false; reason: CategoryRefusal }> {
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, 32);
  const slug = categoryKey(label);
  if (slug.length < 3) return { ok: false, reason: "bad_label" };
  const memberId = input.memberId ?? null;
  // Personal drawers live in their own key space, so two people can each have « Cuisine ».
  const key = memberId ? `${slug}~${memberId}`.slice(0, 64) : slug;
  return db.transaction(async (tx) => {
    const existing = await tx.select({ key: factCategories.key, label: factCategories.label, memberId: factCategories.memberId }).from(factCategories);
    const visible = existing.filter((c) => c.memberId === null || c.memberId === memberId);
    if (memberId ? existing.filter((c) => c.memberId === memberId).length >= MAX_PERSONAL_CATEGORIES : visible.length >= MAX_CATEGORIES) {
      return { ok: false, reason: "full" as const };
    }
    if (existing.some((c) => c.key === key) || visible.some((c) => categoryKey(c.label) === slug)) return { ok: false, reason: "exists" as const };
    const facts = input.factIds.length
      ? await tx
          .select({ id: profileFacts.id, memberId: profileFacts.memberId })
          .from(profileFacts)
          .where(and(inArray(profileFacts.id, input.factIds), isNull(profileFacts.supersededBy), isNull(profileFacts.deletedAt)))
      : [];
    const kept = memberId ? facts.filter((f) => f.memberId === memberId) : facts;
    if (kept.length < MIN_FACTS_FOR_CATEGORY) return { ok: false, reason: "too_few" as const };
    const own = existing.length - Object.keys(BASE_CATEGORY_INFO).length;
    const color = NEW_CATEGORY_COLORS[Math.max(0, own) % NEW_CATEGORY_COLORS.length] ?? "#e6a1ff";
    await tx.insert(factCategories).values({ key, label, color, memberId, createdBy: "archive-9", reason: input.reason.slice(0, 300) });
    
    await tx
      .update(profileFacts)
      .set({ category: key, updatedAt: sql`now()` })
      .where(inArray(profileFacts.id, kept.map((f) => f.id)));
    return { ok: true as const, key };
  });
}

/** Files current facts in another existing drawer they may use. Returns how many moved. */
export async function moveFacts(db: Database, factIds: string[], key: string): Promise<number> {
  if (factIds.length === 0) return 0;
  const [target] = await db.select({ key: factCategories.key, memberId: factCategories.memberId }).from(factCategories).where(eq(factCategories.key, key));
  if (!target) return 0;
  const rows = await db
    .update(profileFacts)
    .set({ category: key, updatedAt: sql`now()` })
    .where(
      and(
        inArray(profileFacts.id, factIds),
        isNull(profileFacts.supersededBy),
        isNull(profileFacts.deletedAt),
        // Someone's own drawer only takes their fragments.
        target.memberId ? eq(profileFacts.memberId, target.memberId) : undefined,
      ),
    )
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
