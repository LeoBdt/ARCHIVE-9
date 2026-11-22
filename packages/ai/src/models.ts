import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { ModelRef } from "./routes.ts";

export interface ProviderConfig {
  openrouterApiKey: string;
  groqApiKey: string;
  /** Upstream providers tried first behind OpenRouter, e.g. `["baidu", "deepinfra"]`. */
  openrouterProviderOrder: string[];
}

export interface ResolvedModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, string | number | boolean>>;
}

export type ModelResolver = (ref: ModelRef) => ResolvedModel;

export function createModelResolver(config: ProviderConfig): ModelResolver {
  const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });
  const groq = createGroq({ apiKey: config.groqApiKey });

  return (ref): ResolvedModel => {
    if (ref.provider === "groq") {
      return { model: groq(ref.model), providerOptions: { groq: { reasoningEffort: "low" } } };
    }
    return {
      model: openrouter(ref.model, {
        usage: { include: true },
        reasoning: { effort: "low" },
        provider: {
          order: config.openrouterProviderOrder,
          allow_fallbacks: true,
          data_collection: "deny",
          quantizations: ["fp8", "fp16", "bf16"],
        },
      }),
      providerOptions: {},
    };
  };
}
