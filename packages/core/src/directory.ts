import { stripCode } from "./mention.ts";

export interface DirectoryEntry {
  id: string;
  /** Display name, username, former names… */
  names: string[];
}

// Initials and short first names that are also everyday French words.
const COMMON_WORDS = new Set([
  "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "je", "tu", "il", "on", "ma", "ta", "sa", "mon", "ton", "son",
  "me", "te", "se", "ce", "ne", "pas", "pa", "au", "aux", "ou", "si", "ni", "toi", "moi", "lui", "elle", "nous", "vous", "eux",
  "est", "suis", "es", "qui", "que", "quoi", "dit", "fait", "bon", "mal", "oui", "non", "ok", "lol", "mdr", "ptdr", "the",
  "and", "for", "you", "bot", "sur", "par", "pour", "avec", "sans", "tout", "rien", "bien", "plus", "moins", "ici",
]);

export function normaliseName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Finds the members a message talks about without tagging them: by full name, former name,
 * first name (3+ letters) or initials of a multi-word name ("jp" for "Jean Pascal").
 * Longer, more specific names win when the limit is reached.
 */
export function createMemberFinder(entries: readonly DirectoryEntry[]): (content: string, limit?: number) => string[] {
  const keys = new Map<string, Set<string>>();
  const add = (key: string, id: string) => {
    if (key.length < 2 || COMMON_WORDS.has(key)) return;
    const ids = keys.get(key) ?? new Set<string>();
    ids.add(id);
    keys.set(key, ids);
  };
  for (const entry of entries) {
    for (const raw of entry.names) {
      const name = normaliseName(raw);
      if (!name) continue;
      const words = name.split(" ");
      if (name.length >= 3) add(name, entry.id);
      if (words.length > 1) {
        add(words.map((word) => word[0] ?? "").join(""), entry.id);
        const first = words[0] ?? "";
        if (first.length >= 3) add(first, entry.id);
      }
    }
  }
  const ordered = [...keys].sort((a, b) => b[0].length - a[0].length);

  return (content, limit = 5) => {
    const text = ` ${normaliseName(stripCode(content))} `;
    const found: string[] = [];
    for (const [key, ids] of ordered) {
      if (!text.includes(` ${key} `)) continue;
      for (const id of ids) if (!found.includes(id)) found.push(id);
      if (found.length >= limit) break;
    }
    return found.slice(0, limit);
  };
}

const USER_MENTION = /<@!?(\d{17,20})>/g;

/** Replaces `<@123…>` tags with `@Name` when the name is known. */
export function resolveMentions(content: string, names: ReadonlyMap<string, string>): string {
  return content.replace(USER_MENTION, (tag, id: string) => {
    const name = names.get(id);
    return name ? `@${name}` : tag;
  });
}
