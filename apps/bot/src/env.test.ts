import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.ts";

const base = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/archive9",
  DISCORD_TOKEN: "token",
  DISCORD_GUILD_ID: "123456789012345678",
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.HEALTH_PORT).toBe(3001);
    expect(env.KNOWN_AI_BOT_IDS).toEqual([]);
  });

  it("splits and trims the AI bot ID list", () => {
    const env = parseEnv({ ...base, KNOWN_AI_BOT_IDS: "123456789012345678, 876543210987654321," });
    expect(env.KNOWN_AI_BOT_IDS).toEqual(["123456789012345678", "876543210987654321"]);
  });

  it("rejects a malformed Discord ID", () => {
    expect(() => parseEnv({ ...base, KNOWN_AI_BOT_IDS: "not-an-id" })).toThrow(/KNOWN_AI_BOT_IDS/);
  });

  it("reports missing required variables", () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
  });
});
