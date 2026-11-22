import type { SelfState, SelfStateSource } from "@archive-9/core";
import { desc, eq, max } from "drizzle-orm";
import type { Database } from "../client.ts";
import { selfStateVersions } from "../schema.ts";

/** Latest self state, creating the initial version on first run. */
export async function currentSelfState(db: Database, initial: SelfState): Promise<SelfState> {
  const [latest] = await db.select().from(selfStateVersions).orderBy(desc(selfStateVersions.version)).limit(1);
  if (latest) return latest.state;
  await db.insert(selfStateVersions).values({ state: initial, source: "initial" });
  return initial;
}

/** Stores a new version, which becomes the current state. */
export async function saveSelfState(db: Database, state: SelfState, source: SelfStateSource, createdBy: string | null): Promise<number> {
  const [row] = await db.insert(selfStateVersions).values({ state, source, createdBy }).returning({ version: selfStateVersions.version });
  return row?.version ?? 0;
}

export async function lastReflectionAt(db: Database): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(selfStateVersions.createdAt) })
    .from(selfStateVersions)
    .where(eq(selfStateVersions.source, "reflection"));
  return row?.at ?? null;
}

/** Latest self state, or null before the bot's first run. Never writes. */
export async function latestSelfState(db: Database): Promise<SelfState | null> {
  const [latest] = await db.select({ state: selfStateVersions.state }).from(selfStateVersions).orderBy(desc(selfStateVersions.version)).limit(1);
  return latest?.state ?? null;
}
