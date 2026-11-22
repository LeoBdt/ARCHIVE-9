export const PROVIDERS = ["openrouter", "groq"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ModelRef {
  provider: ProviderName;
  model: string;
  /** `provider:model`, used as a key for cooldowns and logs. */
  id: string;
}

export function parseModelRef(value: string): ModelRef {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(":");
  const provider = trimmed.slice(0, separator);
  const model = trimmed.slice(separator + 1);
  if (separator <= 0 || !model || !(PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`Invalid model reference "${value}", expected provider:model`);
  }
  return { provider: provider as ProviderName, model, id: `${provider}:${model}` };
}

/** Parses a comma-separated fallback chain such as `openrouter:a,groq:b`. */
export function parseRoute(value: string): ModelRef[] {
  const refs = value.split(",").filter((part) => part.trim()).map(parseModelRef);
  if (refs.length === 0) throw new Error("A route needs at least one model");
  return refs;
}

/** Short model name for display, e.g. `gpt-oss-120b`. */
export function shortModelName(ref: ModelRef): string {
  return ref.model.split("/").pop() ?? ref.model;
}
