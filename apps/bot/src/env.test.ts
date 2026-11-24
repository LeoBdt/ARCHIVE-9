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
    expect(env).toMatchObject({ ANALYSIS_DAILY_BUDGET_USD: 0.1, MESSAGE_RETENTION_DAYS: 30, GITHUB_REPO: "LeoBdt/ARCHIVE-9" });
    expect(env.SITE_URL).toBeUndefined();
  });

  it("validates the learning settings", () => {
    expect(parseEnv({ ...base, SITE_URL: "https://archives.example.org", ANALYSIS_DAILY_BUDGET_USD: "0.5" })).toMatchObject({ SITE_URL: "https://archives.example.org", ANALYSIS_DAILY_BUDGET_USD: 0.5 });
    expect(() => parseEnv({ ...base, SITE_URL: "pas une adresse" })).toThrow(/SITE_URL/);
  });

  it("reads the AGENTS category and the reply budget", () => {
    expect(parseEnv({ ...base, AGENTS_CATEGORY_ID: "1574094410830844105", REPLY_DAILY_BUDGET_USD: "2.5" })).toMatchObject({
      AGENTS_CATEGORY_ID: "1574094410830844105",
      REPLY_DAILY_BUDGET_USD: 2.5,
    });
    expect(parseEnv({ ...base, AGENTS_CATEGORY_ID: "" }).AGENTS_CATEGORY_ID).toBeUndefined();
    expect(parseEnv(base).REPLY_DAILY_BUDGET_USD).toBe(1);
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
