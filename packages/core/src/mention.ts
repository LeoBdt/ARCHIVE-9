const CODE_PATTERN = /```[\s\S]*?```|`[^`\n]*`/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripCode(content: string): string {
  return content.replace(CODE_PATTERN, " ");
}

/** Matches any of `names` as a whole word, case-insensitively, outside code blocks. */
export function createNameMatcher(names: readonly string[]): (content: string) => boolean {
  const cleaned = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (cleaned.length === 0) return () => false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_'’])(?:${cleaned.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`,
    "iu",
  );
  return (content) => pattern.test(stripCode(content));
}
