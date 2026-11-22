import { createDb, ensureWebRole, grantSiteAdmin, saveMessage, syncGuildMembers, WEB_DB_ROLE } from "@archive-9/db";
import { createTestDatabase } from "@archive-9/db/test-utils";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, ROBOTS_TXT, type AuthPort } from "./app.ts";

const url = process.env.TEST_DATABASE_URL;
const OWNER = "100000000000000001";
const MEMBER = "100000000000000002";
const LEFT = "100000000000000003";

/** A session is just the Discord ID in a header, for these tests. */
const fakeAuth: AuthPort = {
  handler: () => Promise.resolve(new Response("auth")),
  discordId: (headers) => Promise.resolve(headers.get("x-test-user")),
};

describe.skipIf(!url)("site server", () => {
  let conn: ReturnType<typeof createDb>;
  let drop: () => Promise<void>;
  let testUrl: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    testUrl = test.url;
    conn = createDb(test.url, { max: 2 });
    const member = (id: string, name: string) => ({ id, username: name, displayName: null, isBot: false, isKnownAiBot: false });
    await syncGuildMembers(conn.db, [member(OWNER, "leo"), member(MEMBER, "tom"), member(LEFT, "parti")]);
    await syncGuildMembers(conn.db, [member(OWNER, "leo"), member(MEMBER, "tom")]);
    await saveMessage(conn.db, { id: "m1", guildId: "g", channelId: "c", authorId: MEMBER, content: "salut", replyToId: null, mentionedIds: [], createdAt: new Date() });
    const dir = await mkdtemp(join(tmpdir(), "a9-web-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>ARCHIVE-9</title>");
    app = createApp({ db: conn.db, auth: fakeAuth, ownerId: OWNER, clientDir: dir });
  });

  afterAll(async () => {
    await conn.close();
    await drop();
  });

  const get = (path: string, user?: string) => app.request(path, { headers: user ? { "x-test-user": user } : {} });

  it("keeps search engines out", async () => {
    const robots = await get("/robots.txt");
    expect(await robots.text()).toBe(ROBOTS_TXT);
    expect(robots.headers.get("x-robots-tag")).toContain("noindex");
    const page = await get("/archives/42");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves the client for its own routes", async () => {
    const page = await get("/archives/42");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("ARCHIVE-9");
  });

  it("needs a session for the API", async () => {
    expect((await get("/api/home")).status).toBe(401);
  });

  it("refuses someone who left the server, or the bot never saw", async () => {
    expect((await get("/api/me", LEFT)).status).toBe(403);
    expect((await get("/api/me", "100000000000000009")).status).toBe(403);
  });

  it("lets members in, and knows the owner and admins", async () => {
    expect(await (await get("/api/me", OWNER)).json()).toMatchObject({ id: OWNER, isOwner: true, isAdmin: true });
    expect(await (await get("/api/me", MEMBER)).json()).toMatchObject({ isOwner: false, isAdmin: false });
    await grantSiteAdmin(conn.db, MEMBER, OWNER);
    expect(await (await get("/api/me", MEMBER)).json()).toMatchObject({ isAdmin: true });
  });

  it("shows the home page data", async () => {
    const home = await get("/api/home", MEMBER);
    expect(home.headers.get("cache-control")).toBe("no-store");
    expect(await home.json()).toMatchObject({ counts: { messages: 1 }, paused: false, status: null });
  });

  it("answers unknown API routes with a 404", async () => {
    expect((await get("/api/nope", MEMBER)).status).toBe(404);
  });

  it("gives the site a database user that reads but can't rewrite the archives", async () => {
    await ensureWebRole(conn.client, "testpassword123456");
    const web = new URL(testUrl);
    web.username = WEB_DB_ROLE;
    web.password = "testpassword123456";
    const site = createDb(web.toString(), { max: 1 });
    try {
      const rows = await site.client`select count(*)::int as n from messages`;
      expect(rows[0]?.n).toBe(1);
      await expect(site.client`delete from messages`).rejects.toThrow(/permission denied/);
      await site.client`insert into web_verification (id, identifier, value, expires_at) values ('v', 'i', 'x', now())`;
    } finally {
      await site.close();
    }
  });
});
