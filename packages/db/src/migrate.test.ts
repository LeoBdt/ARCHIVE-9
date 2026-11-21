import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { members, messages, relationships } from "./schema.ts";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("database schema", () => {
  const conn = createDb(url ?? "", { max: 1 });
  const { db } = conn;

  beforeAll(async () => {
    await db.execute("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url ?? "");
  });

  afterAll(async () => {
    await conn.close();
  });

  it("applies migrations twice without error", async () => {
    await expect(runMigrations(url ?? "")).resolves.toBeUndefined();
  });

  it("enforces the affinity range", async () => {
    await db.insert(members).values({ id: "100000000000000001", username: "a" });
    await expect(
      db.insert(relationships).values({ memberId: "100000000000000001", affinity: 150 }),
    ).rejects.toThrow();
  });

  it("deletes a member's messages with the member", async () => {
    await db.insert(members).values({ id: "100000000000000002", username: "b" });
    await db.insert(messages).values({
      id: "200000000000000001",
      channelId: "300000000000000001",
      authorId: "100000000000000002",
      content: "salut",
      createdAt: new Date(),
    });
    await db.delete(members).where(eq(members.id, "100000000000000002"));
    const rows = await db.select().from(messages).where(eq(messages.authorId, "100000000000000002"));
    expect(rows).toHaveLength(0);
  });
});
