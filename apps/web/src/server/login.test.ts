import { createDb, syncGuildMembers } from "@archive-9/db";
import { createTestDatabase } from "@archive-9/db/test-utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { parseWebEnv } from "./env.ts";

const url = process.env.TEST_DATABASE_URL;
const SITE = "http://localhost:3000";
const MEMBER = "312845519027012345";
const STRANGER = "312845519027099999";

/** Discord's answers: a token, then the profile of whoever `code` names. */
function fakeDiscord(realFetch: typeof fetch) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith("https://discord.com/api/oauth2/token")) {
      const code = init?.body instanceof URLSearchParams ? (init.body.get("code") ?? "") : "";
      return Promise.resolve(Response.json({ access_token: `token-${code}`, token_type: "Bearer", expires_in: 3600, scope: "identify" }));
    }
    if (decodeURIComponent(target).startsWith("https://discord.com/api/users/@me")) {
      const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
      const auth = headers.get("authorization") ?? "";
      const id = auth.replace("Bearer token-", "");
      return Promise.resolve(Response.json({ id, username: `user${id.slice(-3)}`, global_name: "Léo", avatar: null, discriminator: "0", verified: true }));
    }
    return realFetch(input, init);
  });
}

describe.skipIf(!url)("Discord login, end to end", () => {
  let conn: ReturnType<typeof createDb>;
  let drop: () => Promise<void>;
  let app: ReturnType<typeof createApp>;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const test = await createTestDatabase(url ?? "");
    drop = test.drop;
    conn = createDb(test.url, { max: 2 });
    await syncGuildMembers(conn.db, [{ id: MEMBER, username: "leo", displayName: "Léo", isBot: false, isKnownAiBot: false }]);
    const env = parseWebEnv({
      NODE_ENV: "test",
      DATABASE_URL: test.url,
      SITE_URL: SITE,
      SITE_OWNER_ID: MEMBER,
      DISCORD_GUILD_ID: "100000000000000000",
      DISCORD_CLIENT_ID: "client",
      DISCORD_CLIENT_SECRET: "secret",
      BETTER_AUTH_SECRET: "x".repeat(40),
    });
    const auth = createAuth(conn.db, env);
    app = createApp({
      db: conn.db,
      ownerId: MEMBER,
      clientDir: null,
      auth: {
        handler: (request) => auth.handler(request),
        discordId: async (headers) => {
          const session = await auth.api.getSession({ headers });
          return (session?.user as { discordId?: string } | undefined)?.discordId ?? null;
        },
      },
    });
    globalThis.fetch = fakeDiscord(realFetch);
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await conn.close();
    await drop();
  });

  /** Starts a login, comes back from Discord as `code`, returns where it lands and the cookies. */
  async function login(code: string) {
    const start = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ provider: "discord", callbackURL: "/", errorCallbackURL: "/acces?erreur=1" }),
    });
    const { url: authorize } = (await start.json()) as { url: string };
    expect(new URL(authorize).searchParams.get("scope")).toBe("identify");
    const state = new URL(authorize).searchParams.get("state") ?? "";
    const cookies = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const back = await app.request(`/api/auth/callback/discord?code=${code}&state=${state}`, { headers: { cookie: cookies } });
    const session = back.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return { location: back.headers.get("location") ?? "", cookie: session };
  }

  it("lets a member of the server in, without keeping any Discord token", async () => {
    const { location, cookie } = await login(MEMBER);
    expect(location).toBe("/");
    const me = await app.request("/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: MEMBER, isOwner: true });
    const accounts = await conn.client`select access_token, refresh_token from web_account`;
    expect(accounts).toEqual([{ access_token: null, refresh_token: null }]);
    const users = await conn.client`select email, discord_id from web_user`;
    expect(users).toEqual([{ email: `${MEMBER}@discord.invalid`, discord_id: MEMBER }]);
  });

  it("turns away someone the bot doesn't see on the server", async () => {
    const { location } = await login(STRANGER);
    expect(location).toContain("/acces?erreur=1");
    expect(await conn.client`select 1 from web_user where discord_id = ${STRANGER}`).toHaveLength(0);
  });

  it("turns away a member who left the server since", async () => {
    await syncGuildMembers(conn.db, []);
    const { location, cookie } = await login(MEMBER);
    expect(location).toContain("/acces?erreur=1");
    expect(cookie).not.toContain("session_token");
  });
});
