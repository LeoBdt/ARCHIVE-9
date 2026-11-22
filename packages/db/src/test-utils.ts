import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { runMigrations } from "./migrate.ts";

/** Creates a fresh, migrated database next to `TEST_DATABASE_URL` and returns its URL. */
export async function createTestDatabase(baseUrl: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return {
    url: url.toString(),
    drop: async () => {
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
