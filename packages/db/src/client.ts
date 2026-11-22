import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export interface DbOptions {
  max?: number;
}

export function createDb(url: string, options: DbOptions = {}) {
  const client = postgres(url, { max: options.max ?? 5, onnotice: () => undefined });
  const db = drizzle({ client, schema, casing: "snake_case" });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export type Database = ReturnType<typeof createDb>["db"];

export async function ping(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}

/** Tells listeners (the website) that something changed. */
export async function notify(db: Database, event: { type: string; [key: string]: unknown }): Promise<void> {
  await db.execute(sql`select pg_notify('archive9', ${JSON.stringify(event)})`);
}

export type SqlClient = ReturnType<typeof createDb>["client"];

/**
 * Runs `task` while holding a Postgres advisory lock, or returns `{ acquired: false }` when
 * another process holds it. Keeps the bot and the backfill script from analysing at once.
 */
export async function withAdvisoryLock<T>(
  client: SqlClient,
  key: number,
  task: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const connection = await client.reserve();
  try {
    const [row] = await connection<{ ok: boolean }[]>`select pg_try_advisory_lock(${key}) as ok`;
    if (!row?.ok) return { acquired: false };
    try {
      return { acquired: true, value: await task() };
    } finally {
      await connection`select pg_advisory_unlock(${key})`;
    }
  } finally {
    connection.release();
  }
}
