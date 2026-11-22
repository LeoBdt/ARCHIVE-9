import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";

const base = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/archive9",
  DISCORD_TOKEN: "token",
  DISCORD_GUILD_ID: "123456789012345678",
  OPENROUTER_API_KEY: "or",
  GROQ_API_KEY: "gq",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.HEALTH_PORT).toBe(3001);
    expect(env.KNOWN_AI_BOT_IDS).toEqual([]);
    expect(env.BOT_ALIASES).toContain("ARCHIVE-9");
    expect(env.AI_ROUTE_REPLY.map((ref) => ref.id)).toEqual([
      "openrouter:deepseek/deepseek-v4.1-flash",
      "groq:openai/gpt-oss-120b",
    ]);
    expect(env).toMatchObject({ ANALYSIS_DAILY_BUDGET_USD: 0.1, REFLECTION_HOUR: 23, MESSAGE_RETENTION_DAYS: 30 });
  });

  it("validates the learning settings", () => {
    expect(parseEnv({ ...base, REFLECTION_HOUR: "4", ANALYSIS_DAILY_BUDGET_USD: "0.5" })).toMatchObject({ REFLECTION_HOUR: 4, ANALYSIS_DAILY_BUDGET_USD: 0.5 });
    expect(() => parseEnv({ ...base, REFLECTION_HOUR: "24" })).toThrow(/REFLECTION_HOUR/);
  });

  it("splits and trims ID lists", () => {
    const env = parseEnv({ ...base, KNOWN_AI_BOT_IDS: "123456789012345678, 876543210987654321," });
    expect(env.KNOWN_AI_BOT_IDS).toEqual(["123456789012345678", "876543210987654321"]);
  });

  it("rejects a malformed Discord ID", () => {
    expect(() => parseEnv({ ...base, KNOWN_AI_BOT_IDS: "not-an-id" })).toThrow(/KNOWN_AI_BOT_IDS/);
  });

  it("rejects an invalid route", () => {
    expect(() => parseEnv({ ...base, AI_ROUTE_TRIAGE: "gemini:flash" })).toThrow(/AI_ROUTE_TRIAGE/);
  });

  it("reports missing required variables", () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });
});
