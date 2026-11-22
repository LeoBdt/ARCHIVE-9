import type { SelfState } from "@archive-9/core";
import { desc } from "drizzle-orm";
import type { Database } from "../client.ts";
import { selfStateVersions } from "../schema.ts";

/** Latest self state, creating the initial version on first run. */
export async function currentSelfState(db: Database, initial: SelfState): Promise<SelfState> {
  const [latest] = await db.select().from(selfStateVersions).orderBy(desc(selfStateVersions.version)).limit(1);
  if (latest) return latest.state;
  await db.insert(selfStateVersions).values({ state: initial, source: "initial" });
  return initial;
}
