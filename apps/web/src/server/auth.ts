import { schema, siteViewer, type Database } from "@archive-9/db";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { WebEnv } from "./env.ts";

const DAY_S = 24 * 60 * 60;

/** Only people the bot sees on the server get a session. */
export async function canEnter(db: Database, discordId: string): Promise<boolean> {
  const viewer = await siteViewer(db, discordId);
  return viewer?.inGuild === true;
}

/** No OAuth token is kept: Discord only proves who someone is. */
function withoutTokens<T extends Record<string, unknown>>(account: T) {
  return { data: { ...account, accessToken: null, refreshToken: null, idToken: null } };
}

export function createAuth(db: Database, env: WebEnv) {
  return betterAuth({
    appName: "ARCHIVE-9",
    baseURL: env.SITE_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.SITE_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: schema.webUser, session: schema.webSession, account: schema.webAccount, verification: schema.webVerification },
    }),
    user: { additionalFields: { discordId: { type: "string", required: true, unique: true, input: false } } },
    emailAndPassword: { enabled: false },
    socialProviders: {
      discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        // `identify` only: no email, no server list.
        disableDefaultScope: true,
        scope: ["identify"],
        mapProfileToUser: (profile) => ({
          name: profile.global_name ?? profile.username,
          email: `${profile.id}@discord.invalid`,
          emailVerified: false,
          image: undefined,
          discordId: profile.id,
        }),
      },
    },
    session: { expiresIn: 7 * DAY_S, updateAge: DAY_S },
    rateLimit: { enabled: true, window: 60, max: 30 },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      account: {
        create: { before: (account) => Promise.resolve(withoutTokens(account)) },
        update: { before: (account) => Promise.resolve(withoutTokens(account)) },
      },
      user: {
        create: {
          before: async (user) => {
            const discordId = (user as { discordId?: string }).discordId ?? "";
            if (!(await canEnter(db, discordId))) throw new APIError("FORBIDDEN", { message: "not_in_guild" });
            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db.select({ discordId: schema.webUser.discordId }).from(schema.webUser).where(eq(schema.webUser.id, session.userId));
            if (!user || !(await canEnter(db, user.discordId))) throw new APIError("FORBIDDEN", { message: "not_in_guild" });
            return { data: session };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
