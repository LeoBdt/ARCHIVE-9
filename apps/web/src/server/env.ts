import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "expected a Discord ID");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().positive().default(3000),
  BOT_TIMEZONE: z.string().default("Europe/Paris"),

  /** The site's own Postgres user, created by the bot. */
  DATABASE_URL: z.url(),
  SITE_URL: z.url(),
  /** Always admin, and the only one who names other admins. */
  SITE_OWNER_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
});

export type WebEnv = z.infer<typeof schema>;

export function parseWebEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  return result.data;
}
