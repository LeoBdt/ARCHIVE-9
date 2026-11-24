import type { AiCallStatus, AiTask } from "@archive-9/core";
import type { LanguageModelUsage } from "ai";
import type { ModelRef } from "./routes.ts";

export interface UsageRecord {
  task: AiTask;
  provider: string;
  model: string;
  upstreamProvider: string | null;
  /** The model a router really used (openrouter/free picks one), when it differs. */
  servedModel?: string | null;
  fallbackReason: string | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  durationMs: number;
  status: AiCallStatus;
  error: string | null;
}

interface ResultLike {
  totalUsage: LanguageModelUsage;
  providerMetadata?: Record<string, unknown> | undefined;
  response?: { modelId?: string | undefined };
}

interface OpenRouterMeta {
  provider?: unknown;
  usage?: { cost?: unknown };
}

function openrouterMeta(result: ResultLike): OpenRouterMeta | undefined {
  const meta: unknown = result.providerMetadata?.openrouter;
  return typeof meta === "object" && meta !== null ? meta : undefined;
}

export function usageFromResult(
  task: AiTask,
  ref: ModelRef,
  result: ResultLike,
  durationMs: number,
  fallbackReason: string | null,
): UsageRecord {
  const meta = openrouterMeta(result);
  const cost = meta?.usage?.cost;
  const served = result.response?.modelId;
  return {
    task,
    provider: ref.provider,
    model: ref.model,
    servedModel: served && served !== ref.model && !ref.model.endsWith(served) ? served : null,
    upstreamProvider: typeof meta?.provider === "string" ? meta.provider : null,
    fallbackReason,
    inputTokens: result.totalUsage.inputTokens ?? 0,
    outputTokens: result.totalUsage.outputTokens ?? 0,
    reasoningTokens: result.totalUsage.outputTokenDetails.reasoningTokens ?? 0,
    costUsd: typeof cost === "number" ? cost : ref.provider === "groq" ? 0 : null,
    durationMs,
    status: "ok",
    error: null,
  };
}

export function usageFromError(
  task: AiTask,
  ref: ModelRef,
  reason: string,
  error: unknown,
  durationMs: number,
): UsageRecord {
  return {
    task,
    provider: ref.provider,
    model: ref.model,
    upstreamProvider: null,
    fallbackReason: null,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
    durationMs,
    status: reason === "rate_limited" ? "rate_limited" : "error",
    error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
  };
}
