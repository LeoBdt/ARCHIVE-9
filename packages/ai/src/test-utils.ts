import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { ModelResolver } from "./models.ts";

type Content = LanguageModelV4GenerateResult["content"];

export function mockResult(
  content: Content,
  extra: Partial<Pick<LanguageModelV4GenerateResult, "providerMetadata" | "response">> = {},
): LanguageModelV4GenerateResult {
  const hasToolCall = content.some((part) => part.type === "tool-call");
  return {
    content,
    finishReason: { unified: hasToolCall ? "tool-calls" : "stop", raw: undefined },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 20, text: 15, reasoning: 5 },
    },
    warnings: [],
    ...extra,
  };
}

export const text = (value: string): Content => [{ type: "text", text: value }];

export const toolCall = (toolName: string, input: unknown): Content => [
  { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
];

export function httpError(statusCode: number, headers: Record<string, string> = {}): APICallError {
  return new APICallError({
    message: `HTTP ${String(statusCode)}`,
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });
}

export function mockModel(behaviour: LanguageModelV4GenerateResult | Error | (() => LanguageModelV4GenerateResult)) {
  return new MockLanguageModelV4({
    doGenerate: () => {
      if (behaviour instanceof Error) return Promise.reject(behaviour);
      return Promise.resolve(typeof behaviour === "function" ? behaviour() : behaviour);
    },
  });
}

/** Resolver that maps `provider:model` ids to prepared mock models. */
export function mockResolver(models: Record<string, MockLanguageModelV4>): ModelResolver {
  return (ref) => {
    const model = models[ref.id];
    if (!model) throw new Error(`no mock for ${ref.id}`);
    return { model, providerOptions: {} };
  };
}
