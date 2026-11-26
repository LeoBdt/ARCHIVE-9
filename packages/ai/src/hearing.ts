import type { UsageRecord } from "./usage.ts";

export interface HearingConfig {
  groqApiKey: string;
  /** `whisper-large-v3-turbo`: fast, 0.04 $ an hour of audio, billed 10 s at least. */
  model?: string;
  baseUrl?: string;
}

export interface Heard {
  text: string | null;
  usage: UsageRecord;
}

const PRICE_PER_HOUR = 0.04;

/** Speech to text with Whisper on Groq. `seconds` is the length of the clip, for the cost. */
export async function transcribe(config: HearingConfig, wav: Uint8Array, seconds: number, fetchImpl: typeof fetch = fetch): Promise<Heard> {
  const model = config.model ?? "whisper-large-v3-turbo";
  const started = Date.now();
  const usage: UsageRecord = {
    task: "voice",
    provider: "groq",
    model,
    upstreamProvider: null,
    fallbackReason: null,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: (Math.max(10, seconds) / 3600) * PRICE_PER_HOUR,
    durationMs: 0,
    status: "ok",
    error: null,
  };
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "voice.wav");
  form.append("model", model);
  form.append("language", "fr");
  form.append("response_format", "json");
  form.append("temperature", "0");
  // Helps it spell its name the way the code looks for it.
  form.append("prompt", "Archive, tu en penses quoi ? Conversation entre potes sur Discord.");
  try {
    const response = await fetchImpl(`${config.baseUrl ?? "https://api.groq.com/openai/v1"}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.groqApiKey}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json()) as { text?: string; error?: { message?: string } };
    const durationMs = Date.now() - started;
    if (!response.ok) return { text: null, usage: { ...usage, durationMs, costUsd: 0, status: response.status === 429 ? "rate_limited" : "error", error: (body.error?.message ?? `HTTP ${String(response.status)}`).slice(0, 500) } };
    const text = body.text?.trim() ?? "";
    return { text: text || null, usage: { ...usage, durationMs } };
  } catch (error) {
    return { text: null, usage: { ...usage, costUsd: 0, durationMs: Date.now() - started, status: "error", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) } };
  }
}
