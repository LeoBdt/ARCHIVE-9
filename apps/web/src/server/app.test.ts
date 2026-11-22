import { applyAnalysis, createDb, currentFacts, ensureWebRole, grantSiteAdmin, readSettings, recordDecision, saveMessage, syncGuildMembers, WEB_DB_ROLE } from "@archive-9/db";
import { createTestDatabase } from "@archive-9/db/test-utils";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, ROBOTS_TXT, type AuthPort } from "./app.ts";
import { startLive } from "./live.ts";

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
    await syncGuildMembers(conn.db, [member(OWNER, "leo"), member(MEMBER, "tom"), member("100000000000000004", "max")]);
    await saveMessage(conn.db, { id: "m1", guildId: "g", channelId: "c", authorId: MEMBER, content: "salut", replyToId: null, mentionedIds: [], createdAt: new Date() });
    const dir = await mkdtemp(join(tmpdir(), "a9-web-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><head><!--link-preview--><title>ARCHIVE-9</title></head>");
    await writeFile(join(dir, "og.png"), "png");
    app = createApp({ db: conn.db, auth: fakeAuth, ownerId: OWNER, clientDir: dir, siteUrl: "https://archive.example.org" });
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

  it("lets Discord preview the home page, and only that", async () => {
    expect(ROBOTS_TXT).toMatch(/User-agent: Discordbot\nAllow: \/\$\nAllow: \/og\.png\nDisallow: \//);
    expect(ROBOTS_TXT.endsWith("User-agent: *\nDisallow: /\n")).toBe(true);
    const home = await (await get("/")).text();
    expect(home).toContain('<meta property="og:image" content="https://archive.example.org/og.png" />');
    expect(home).not.toContain("link-preview");
    expect((await get("/og.png")).status).toBe(200);
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

  const post = (path: string, user: string, body: unknown, origin = "https://archive.example.org") =>
    app.request(path, { method: "POST", headers: { "x-test-user": user, "content-type": "application/json", origin }, body: JSON.stringify(body) });

  it("refuses writes coming from another site", async () => {
    expect((await post("/api/settings", OWNER, { paused: true }, "https://evil.example")).status).toBe(403);
  });

  it("keeps settings to admins and the admin list to the owner", async () => {
    expect((await get("/api/settings", "100000000000000004")).status).toBe(403);
    expect((await post("/api/settings", OWNER, { spontaneity: 2 })).status).toBe(200);
    expect((await readSettings(conn.db)).spontaneity).toBe(2);
    expect((await post("/api/settings", OWNER, { spontaneity: 9 })).status).toBe(400);
    expect((await get("/api/access", MEMBER)).status).toBe(403);
    expect((await get("/api/access", OWNER)).status).toBe(200);
    expect((await post("/api/access", OWNER, { memberId: OWNER, admin: false })).status).toBe(400);
  });

  it("lets a member edit only their own facts, and admins anyone's", async () => {
    await applyAnalysis(conn.db, {
      facts: [{ memberId: MEMBER, category: "identity", nature: "fact", confidence: 0.9, content: "En licence.", sourceMessageIds: [], reportedBy: null, replacesId: null }],
      retractions: [],
      relationships: [],
      analysedIds: [],
      at: new Date(),
    });
    const [fact] = await currentFacts(conn.db, MEMBER, 5);
    expect((await post(`/api/facts/${fact?.id ?? ""}`, "100000000000000004", { action: "correct", content: "Volé." })).status).toBe(404);
    expect((await post(`/api/facts/${fact?.id ?? ""}`, MEMBER, { action: "correct", content: "06 12 34 56 78 99" })).status).toBe(400);
    expect((await post(`/api/facts/${fact?.id ?? ""}`, MEMBER, { action: "correct", content: "En master." })).status).toBe(200);
    const [corrected] = await currentFacts(conn.db, MEMBER, 5);
    expect(corrected?.content).toBe("En master.");
    // The owner is an admin: they may fix anyone's profile.
    expect((await post(`/api/facts/${corrected?.id ?? ""}`, OWNER, { action: "remove", reason: "doublon" })).status).toBe(200);
    expect(await currentFacts(conn.db, MEMBER, 5)).toEqual([]);
  });

  it("shows replies in the journal, DMs only to their member", async () => {
    const reply = { channelId: "c", authorId: OWNER, outcome: "replied" as const, addressed: true, content: "salut", details: { sent: "yo" } };
    await recordDecision(conn.db, { ...reply, messageId: "d1", guildId: "g", channelName: "général" });
    await recordDecision(conn.db, { ...reply, messageId: "d2", guildId: null });
    await recordDecision(conn.db, { channelId: "c", authorId: OWNER, outcome: "ignored", reason: "outside_agents", messageId: "d3", guildId: "g" });
    const forMember = (await (await get("/api/journal", "100000000000000004")).json()) as { replies: { isDm: boolean }[] };
    expect(forMember.replies.map((r) => r.isDm)).toEqual([false]);
    const forOwner = (await (await get("/api/journal", OWNER)).json()) as { replies: unknown[] };
    expect(forOwner.replies).toHaveLength(2);
    const backstage = (await (await get("/api/coulisses", "100000000000000004")).json()) as { ignored: { reason: string; n: number }[] };
    expect(backstage.ignored).toEqual([{ reason: "outside_agents", n: 1 }]);
  });

  it("tells open pages when something changes, only to members", async () => {
    const live = await startLive(conn.client, () => undefined);
    const liveApp = createApp({ db: conn.db, auth: fakeAuth, ownerId: OWNER, clientDir: null, siteUrl: "https://archive.example.org", live });
    expect((await liveApp.request("/api/live")).status).toBe(401);
    const res = await liveApp.request("/api/live", { headers: { "x-test-user": MEMBER } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: ready")) text += decoder.decode((await reader.read()).value);
    await recordDecision(conn.db, { channelId: "c", authorId: OWNER, outcome: "ignored", messageId: "live1", guildId: "g" });
    while (!text.includes("data: decisions")) text += decoder.decode((await reader.read()).value);
    expect(text).toContain("event: change");
    await reader.cancel();
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
