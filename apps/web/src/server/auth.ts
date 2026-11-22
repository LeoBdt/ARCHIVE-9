import { schema, siteViewer, type Database } from "@archive-9/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { WebEnv } from "./env.ts";

const DAY_S = 24 * 60 * 60;

/** Only people the bot sees on the server get a session. */
export async function canEnter(db: Database, discordId: string): Promise<boolean> {
  const viewer = await siteViewer(db, discordId);
  return viewer?.inGuild === true;
}

const PLACEHOLDER_DOMAIN = "discord.invalid";

/**
 * The Discord ID, read back from the placeholder email. `discordId` can't come from the
 * profile itself: Better Auth drops `input: false` fields from it, and that flag is what
 * stops anyone from changing their ID through the API.
 */
export function discordIdFromEmail(email: string): string | null {
  return /^(\d{17,20})@discord\.invalid$/.exec(email)?.[1] ?? null;
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
    // Filled by the user.create hook below; the database still requires it.
    user: { additionalFields: { discordId: { type: "string", required: false, unique: true, input: false } } },
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
          email: `${profile.id}@${PLACEHOLDER_DOMAIN}`,
          emailVerified: false,
          image: undefined,
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
            const discordId = discordIdFromEmail(user.email);
            // false cancels the sign-up: Better Auth sends the person back to the error page.
            if (!discordId || !(await canEnter(db, discordId))) return false;
            return { data: { ...user, discordId } };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db.select({ discordId: schema.webUser.discordId }).from(schema.webUser).where(eq(schema.webUser.id, session.userId));
            if (!user || !(await canEnter(db, user.discordId))) return false;
            return { data: session };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
