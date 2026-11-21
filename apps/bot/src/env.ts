import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "expected a Discord ID");

const idList = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean))
  .pipe(z.array(snowflake));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.url(),

  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: snowflake,
  KNOWN_AI_BOT_IDS: idList,
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
