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
  vision: "openrouter:deepseek/deepseek-v4.1-flash,groq:meta-llama/llama-4-scout-17b-16e-instruct",
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3001),
  BOT_TIMEZONE: z.string().default("Europe/Paris"),
  /** Set by the image build. */
  GIT_SHA: z.string().default("dev"),

  DATABASE_URL: z.url(),

  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: snowflake,
  KNOWN_AI_BOT_IDS: idList,
  BOT_ALIASES: list.default(["ARCHIVE-9", "ARCHIVE9", "archive 9", "A9"]),
  BOT_SOFT_ALIASES: list.default(["archive"]),
  LISTENED_CHANNEL_IDS: idList,
  /** The AGENTS category: free speech there, explicit @mentions and replies only elsewhere. */
  AGENTS_CATEGORY_ID: z.preprocess((v) => (v === "" ? undefined : v), snowflake.optional()),

  OPENROUTER_API_KEY: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  OPENROUTER_PROVIDER_ORDER: list.default(["baidu", "deepinfra", "alibaba"]),
  AI_ROUTE_TRIAGE: route(DEFAULT_ROUTES.triage),
  AI_ROUTE_REPLY: route(DEFAULT_ROUTES.reply),
  AI_ROUTE_ANALYSIS: route(DEFAULT_ROUTES.analysis),
  AI_ROUTE_REFLECTION: route(DEFAULT_ROUTES.reflection),
  AI_ROUTE_VISION: route(DEFAULT_ROUTES.vision),
  /** OpenRouter embeddings model for the search index (1024 dimensions). */
  EMBEDDING_MODEL: z.string().default("baai/bge-m3"),

  ANALYSIS_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(0.1),
  /** Its voice: the Piper container. Unset: it can't join voice channels. */
  PIPER_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  /** Speech recognition in voice channels, over 24 h. */
  VOICE_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(0.2),
  /** Looking at images, over 24 h. */
  VISION_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(0.1),
  /** Past this over 24 h, only humans who mention or reply get an answer, from free models. */
  REPLY_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  /** Password of the site's read-mostly Postgres user, created by the bot. Unset: no site. */
  WEB_DB_PASSWORD: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  /** The site's public address: in the bio, and given to the model to link it in full. */
  SITE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  /** Public repository the changelog is read from. */
  GITHUB_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default("LeoBdt/ARCHIVE-9"),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof schema>;

/** Every task's chain. Embeddings go through their own client, so they share the analysis entry here. */
export function routesFrom(env: Env) {
  return {
    triage: env.AI_ROUTE_TRIAGE,
    reply: env.AI_ROUTE_REPLY,
    analysis: env.AI_ROUTE_ANALYSIS,
    reflection: env.AI_ROUTE_REFLECTION,
    vision: env.AI_ROUTE_VISION,
    embedding: env.AI_ROUTE_ANALYSIS,
    voice: env.AI_ROUTE_TRIAGE,
  };
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
