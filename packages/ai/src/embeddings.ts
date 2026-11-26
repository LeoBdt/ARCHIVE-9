import type { UsageRecord } from "./usage.ts";

export interface EmbeddingConfig {
  apiKey: string;
  /** `baai/bge-m3`: multilingual, 1024 dimensions. */
  model: string;
  baseUrl?: string;
}

export interface EmbeddingOutcome {
  vectors: number[][] | null;
  usage: UsageRecord;
}

/** Turns texts into vectors through OpenRouter's embeddings endpoint (OpenAI format). */
export async function embedTexts(config: EmbeddingConfig, texts: string[], fetchImpl: typeof fetch = fetch): Promise<EmbeddingOutcome> {
  const started = Date.now();
  const base: UsageRecord = {
    task: "embedding",
    provider: "openrouter",
    model: config.model,
    upstreamProvider: null,
    fallbackReason: null,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: null,
    durationMs: 0,
    status: "ok",
    error: null,
  };
  try {
    const response = await fetchImpl(`${config.baseUrl ?? "https://openrouter.ai/api/v1"}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, input: texts, provider: { data_collection: "deny" } }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
      usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number };
      provider?: string;
      error?: { message?: string };
    };
    const durationMs = Date.now() - started;
    if (!response.ok || !body.data) {
      return { vectors: null, usage: { ...base, durationMs, status: response.status === 429 ? "rate_limited" : "error", error: (body.error?.message ?? `HTTP ${String(response.status)}`).slice(0, 500) } };
    }
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const tokens = body.usage?.prompt_tokens ?? body.usage?.total_tokens ?? 0;
    return {
      vectors: vectors.length === texts.length ? vectors : null,
      usage: { ...base, durationMs, inputTokens: tokens, upstreamProvider: body.provider ?? null, costUsd: typeof body.usage?.cost === "number" ? body.usage.cost : null },
    };
  } catch (error) {
    return { vectors: null, usage: { ...base, durationMs: Date.now() - started, status: "error", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) } };
  }
}
