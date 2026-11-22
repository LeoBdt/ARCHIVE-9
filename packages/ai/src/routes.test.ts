import { describe, expect, it } from "vitest";
import { parseModelRef, parseRoute, shortModelName } from "./routes.ts";

describe("routes", () => {
  it("parses a chain", () => {
    expect(parseRoute("openrouter:deepseek/deepseek-v4.1-flash, groq:openai/gpt-oss-120b")).toEqual([
      { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash", id: "openrouter:deepseek/deepseek-v4.1-flash" },
      { provider: "groq", model: "openai/gpt-oss-120b", id: "groq:openai/gpt-oss-120b" },
    ]);
  });

  it("keeps colons inside model ids", () => {
    expect(parseModelRef("openrouter:vendor/model:free").model).toBe("vendor/model:free");
  });

  it.each(["", "nope", "gemini:flash", "groq:"])("rejects %j", (value) => {
    expect(() => parseRoute(value)).toThrow();
  });

  it("shortens model names", () => {
    expect(shortModelName(parseModelRef("groq:openai/gpt-oss-120b"))).toBe("gpt-oss-120b");
    expect(shortModelName(parseModelRef("groq:plain"))).toBe("plain");
  });
});
