import { describe, expect, it } from "vitest";
import { createModelResolver } from "./models.ts";
import { parseModelRef } from "./routes.ts";

describe("createModelResolver", () => {
  const resolve = createModelResolver({ openrouterApiKey: "k1", groqApiKey: "k2", openrouterProviderOrder: ["baidu"] });

  it("builds Groq models with low reasoning effort", () => {
    const { model, providerOptions } = resolve(parseModelRef("groq:openai/gpt-oss-20b"));
    expect(typeof model === "object" && model.modelId).toBe("openai/gpt-oss-20b");
    expect(providerOptions).toEqual({ groq: { reasoningEffort: "low" } });
  });

  it("builds OpenRouter models", () => {
    const { model, providerOptions } = resolve(parseModelRef("openrouter:deepseek/deepseek-v4.1-flash"));
    expect(typeof model === "object" && model.provider).toContain("openrouter");
    expect(providerOptions).toEqual({});
  });
});
