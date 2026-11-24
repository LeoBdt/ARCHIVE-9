import { nextVersionLabel, type ReflectionKind, type SelfState, type SelfStateSource } from "@archive-9/core";
import { desc, eq, max } from "drizzle-orm";
import type { Database } from "../client.ts";
import { selfStateVersions } from "../schema.ts";

/** Latest self state, creating the initial version on first run. */
export async function currentSelfState(db: Database, initial: SelfState): Promise<SelfState> {
  const [latest] = await db.select().from(selfStateVersions).orderBy(desc(selfStateVersions.version)).limit(1);
  if (latest) return latest.state;
  await db.insert(selfStateVersions).values({ state: initial, source: "initial", label: 1 });
  return initial;
}

const KIND_OF: Partial<Record<SelfStateSource, ReflectionKind>> = { reflection: "evening", midday: "midday" };

/** Stores a new version, which becomes the current state, with its number in half steps. */
export async function saveSelfState(db: Database, state: SelfState, source: SelfStateSource, createdBy: string | null): Promise<{ version: number; label: number }> {
  return db.transaction(async (tx) => {
    const [last] = await tx.select({ label: selfStateVersions.label }).from(selfStateVersions).orderBy(desc(selfStateVersions.version)).limit(1).for("update");
    const label = nextVersionLabel(last ? last.label : null, KIND_OF[source] ?? "other");
    const [row] = await tx.insert(selfStateVersions).values({ state, source, createdBy, label }).returning({ version: selfStateVersions.version });
    return { version: row?.version ?? 0, label };
  });
}

/** When the last evening and midday reflections happened. */
export async function lastReflections(db: Database): Promise<{ midday: Date | null; evening: Date | null }> {
  const at = async (source: SelfStateSource) => {
    const [row] = await db.select({ at: max(selfStateVersions.createdAt) }).from(selfStateVersions).where(eq(selfStateVersions.source, source));
    return row?.at ?? null;
  };
  const [midday, evening] = await Promise.all([at("midday"), at("reflection")]);
  return { midday, evening };
}

/** When it last reflected, midday or evening. */
export async function lastReflectionAt(db: Database): Promise<Date | null> {
  const { midday, evening } = await lastReflections(db);
  if (!midday || !evening) return midday ?? evening;
  return midday > evening ? midday : evening;
}

/** Latest self state, or null before the bot's first run. Never writes. */
export async function latestSelfState(db: Database): Promise<SelfState | null> {
  const [latest] = await db.select({ state: selfStateVersions.state }).from(selfStateVersions).orderBy(desc(selfStateVersions.version)).limit(1);
  return latest?.state ?? null;
}
