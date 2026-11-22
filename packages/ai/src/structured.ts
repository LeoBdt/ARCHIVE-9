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
