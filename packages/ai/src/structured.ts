import type { z } from "zod";

/** Validated structured output of a `generateText` result, or null when there is none. */
export function readStructured<S extends z.ZodType>(result: unknown, schema: S): z.infer<S> | null {
  try {
    const parsed = schema.safeParse((result as { output: unknown }).output);
    return parsed.success ? parsed.data : null;
  } catch {
    // The SDK throws when the model produced no structured output at all.
    return null;
  }
}

/** Why a result has no valid structured output, in a few words, for the error log. */
export function structuredProblem(result: unknown, schema: z.ZodType): string {
  let output: unknown;
  try {
    output = (result as { output: unknown }).output;
  } catch {
    const text = (result as { text?: unknown }).text;
    return typeof text === "string" && text.trim() ? `no JSON, text instead: ${text.trim().slice(0, 120)}` : "empty answer (no JSON)";
  }
  const parsed = schema.safeParse(output);
  if (parsed.success) return "valid";
  const issue = parsed.error.issues[0];
  return issue ? `${issue.path.join(".") || "root"}: ${issue.message}`.slice(0, 200) : "invalid JSON";
}
