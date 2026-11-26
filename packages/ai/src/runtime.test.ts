import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { CooldownTracker } from "./cooldowns.ts";
import { parseRoute } from "./routes.ts";
import { AiRuntime, isPaidModel, type Routes } from "./runtime.ts";
import { httpError, mockModel, mockResolver, mockResult, text } from "./test-utils.ts";

const chain = parseRoute("openrouter:primary,groq:backup");
const routes: Routes = { triage: chain, reply: chain, analysis: chain, reflection: chain, vision: chain, embedding: chain };

function run(ai: AiRuntime, accept?: (r: { response: unknown }) => boolean) {
  return ai.generate(
    "reply",
    ({ model }) => generateText({ model, prompt: "hi", maxRetries: 0 }),
    accept ? { accept } : {},
  );
}

describe("AiRuntime", () => {
  it("uses the primary model when it works", async () => {
    const ai = new AiRuntime(
      routes,
      mockResolver({
        "openrouter:primary": mockModel(
          mockResult(text("ok"), { providerMetadata: { openrouter: { provider: "Baidu", usage: { cost: 0.0002 } } } }),
        ),
        "groq:backup": mockModel(new Error("should not be called")),
      }),
    );
    const outcome = await run(ai);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.ref.id).toBe("openrouter:primary");
    expect(outcome.isFallback).toBe(false);
    expect(outcome.usage).toEqual([
      expect.objectContaining({ status: "ok", upstreamProvider: "Baidu", costUsd: 0.0002, inputTokens: 100, outputTokens: 20, reasoningTokens: 5, fallbackReason: null }),
    ]);
    expect(ai.primary("reply")?.id).toBe("openrouter:primary");
  });

  it("only uses free models once the budget is spent", async () => {
    const primary = mockModel(mockResult(text("cher")));
    const ai = new AiRuntime(routes, mockResolver({ "openrouter:primary": primary, "groq:backup": mockModel(mockResult(text("gratuit"))) }));
    const outcome = await ai.generate("reply", ({ model }) => generateText({ model, prompt: "hi", maxRetries: 0 }), { freeOnly: true });
    expect(outcome.ok && outcome.result.text).toBe("gratuit");
    expect(outcome.ok && outcome.usage[0]?.fallbackReason).toBe("openrouter:primary budget_spent");
    expect(primary.doGenerateCalls).toHaveLength(0);
  });

  it("tells paid models from free ones", () => {
    expect(parseRoute("openrouter:deepseek/x,openrouter:openrouter/free,openrouter:a/b:free,groq:c").map(isPaidModel)).toEqual([true, false, false, false]);
  });

  it("falls back on a rate limit and records why", async () => {
    const ai = new AiRuntime(
      routes,
      mockResolver({
        "openrouter:primary": mockModel(httpError(429, { "retry-after": "30" })),
        "groq:backup": mockModel(mockResult(text("ok"))),
      }),
    );
    const outcome = await run(ai);
    expect(outcome.ok && outcome.ref.id).toBe("groq:backup");
    expect(outcome.ok && outcome.isFallback).toBe(true);
    expect(outcome.usage.map((u) => u.status)).toEqual(["rate_limited", "ok"]);
    expect(outcome.usage[1]?.fallbackReason).toBe("openrouter:primary rate_limited");
    expect(outcome.usage[1]?.costUsd).toBe(0);
  });

  it("skips a model that is still cooling down", async () => {
    const tracker = new CooldownTracker();
    tracker.coolDown("openrouter:primary", 60_000, "no_credits");
    const primary = mockModel(mockResult(text("unused")));
    const ai = new AiRuntime(
      routes,
      mockResolver({ "openrouter:primary": primary, "groq:backup": mockModel(mockResult(text("ok"))) }),
      tracker,
    );
    const outcome = await run(ai);
    expect(primary.doGenerateCalls).toHaveLength(0);
    expect(outcome.usage).toHaveLength(1);
    expect(outcome.usage[0]?.fallbackReason).toBe("openrouter:primary no_credits");
  });

  it("tries the next model when a result is rejected", async () => {
    const ai = new AiRuntime(
      routes,
      mockResolver({
        "openrouter:primary": mockModel(mockResult(text("bad"))),
        "groq:backup": mockModel(mockResult(text("good"))),
      }),
    );
    let calls = 0;
    const outcome = await run(ai, () => ++calls > 1);
    expect(outcome.ok && outcome.ref.id).toBe("groq:backup");
    expect(outcome.usage[0]).toMatchObject({ status: "error", error: "rejected output" });
  });

  it("reports failure when every model fails", async () => {
    const ai = new AiRuntime(
      routes,
      mockResolver({
        "openrouter:primary": mockModel(httpError(500)),
        "groq:backup": mockModel(new Error("down")),
      }),
    );
    const outcome = await run(ai);
    expect(outcome.ok).toBe(false);
    expect(outcome.usage.map((u) => u.status)).toEqual(["error", "error"]);
    expect(outcome.usage[1]?.error).toBe("down");
  });
});
