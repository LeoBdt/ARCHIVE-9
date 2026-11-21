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
