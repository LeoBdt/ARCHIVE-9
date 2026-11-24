import { desc, eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { releases, type ReleaseItem } from "../schema.ts";

export type Release = typeof releases.$inferSelect;

export async function latestReleases(db: Database, kind: "core" | "site", limit = 2): Promise<Release[]> {
  return db.select().from(releases).where(eq(releases.kind, kind)).orderBy(desc(releases.createdAt)).limit(limit);
}

export async function saveRelease(
  db: Database,
  input: { kind: "core" | "site"; label: string; sha: string; previousSha: string | null; comment: string | null; items: ReleaseItem[]; commits: { sha: string; title: string }[] },
): Promise<void> {
  await db.insert(releases).values(input).onConflictDoNothing();
}
