import { parseRoute, type ModelRef } from "@archive-9/ai";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "expected a Discord ID");

const list = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean));

const idList = list.pipe(z.array(snowflake));

const route = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value, ctx): ModelRef[] => {
      try {
        return parseRoute(value);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message });
        return z.NEVER;
      }
    });

export const DEFAULT_ROUTES = {
  triage: "groq:openai/gpt-oss-20b,openrouter:openrouter/free",
  reply: "openrouter:deepseek/deepseek-v4.1-flash,groq:openai/gpt-oss-120b",
  analysis: "openrouter:deepseek/deepseek-v4.1-flash",
  reflection: "openrouter:deepseek/deepseek-v4.1-flash",
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3001),
  BOT_TIMEZONE: z.string().default("Europe/Paris"),

  DATABASE_URL: z.url(),

  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: snowflake,
  KNOWN_AI_BOT_IDS: idList,
  BOT_ALIASES: list.default(["ARCHIVE-9", "ARCHIVE9", "archive 9", "A9"]),
  BOT_SOFT_ALIASES: list.default(["archive"]),
  LISTENED_CHANNEL_IDS: idList,

  OPENROUTER_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  OPENROUTER_PROVIDER_ORDER: list.default(["baidu", "deepinfra", "alibaba"]),
  AI_ROUTE_TRIAGE: route(DEFAULT_ROUTES.triage),
  AI_ROUTE_REPLY: route(DEFAULT_ROUTES.reply),
  AI_ROUTE_ANALYSIS: route(DEFAULT_ROUTES.analysis),
  AI_ROUTE_REFLECTION: route(DEFAULT_ROUTES.reflection),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
