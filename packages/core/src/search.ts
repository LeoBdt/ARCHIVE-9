import { parseFragmentNumber, parseFragmentRef } from "./fragments.ts";

export const SEARCH_KINDS = ["fragments", "messages", "dossiers", "skills", "journal", "relations"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchQuery {
  /** Free words, accents and case ignored later. */
  text: string;
  /** Exact phrases, from "quotes". */
  phrases: string[];
  /** `@léa`: people, by name or former name. */
  people: string[];
  /** `#K7QX3M`. */
  refs: string[];
  /** `F012`, only with a person. */
  numbers: number[];
  drawer: string | null;
  nature: string | null;
  kind: SearchKind | null;
  after: Date | null;
  before: Date | null;
}

const KIND_ALIASES: Record<string, SearchKind> = {
  fragment: "fragments",
  fragments: "fragments",
  message: "messages",
  messages: "messages",
  dossier: "dossiers",
  dossiers: "dossiers",
  skill: "skills",
  skills: "skills",
  journal: "journal",
  relation: "relations",
  relations: "relations",
};

const NATURE_ALIASES: Record<string, string> = {
  fait: "fact",
  fact: "fact",
  rapporte: "reported",
  rapporté: "reported",
  reported: "reported",
  blague: "probable_joke",
  joke: "probable_joke",
  deduction: "inference",
  déduction: "inference",
  inference: "inference",
};

/** `2026-11-20`, `20/11/2026` or `20/11` (this year). */
function parseDay(value: string, now: Date): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const fr = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(value);
  const [y, m, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : fr ? [Number(fr[3] ?? now.getFullYear()), Number(fr[2]), Number(fr[1])] : [0, 0, 0];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Reads the search bar: free words plus `@personne`, `#K7QX3M`, `F012`, `tiroir:`,
 * `nature:`, `type:`, `après:` / `avant:` and "exact phrases".
 */
export function parseSearchQuery(input: string, now = new Date()): SearchQuery {
  const query: SearchQuery = { text: "", phrases: [], people: [], refs: [], numbers: [], drawer: null, nature: null, kind: null, after: null, before: null };
  const words: string[] = [];
  const rest = input.slice(0, 300).replace(/"([^"]{1,100})"/g, (_, phrase: string) => {
    if (phrase.trim()) query.phrases.push(phrase.trim());
    return " ";
  });
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    const [key, ...valueParts] = token.split(":");
    const value = valueParts.join(":");
    const lower = key?.toLowerCase() ?? "";
    if (value && (lower === "tiroir" || lower === "drawer")) query.drawer = value.replace(/_/g, " ");
    else if (value && lower === "nature") query.nature = NATURE_ALIASES[value.toLowerCase()] ?? null;
    else if (value && lower === "type") query.kind = KIND_ALIASES[value.toLowerCase()] ?? null;
    else if (value && (lower === "après" || lower === "apres" || lower === "after")) query.after = parseDay(value, now);
    else if (value && (lower === "avant" || lower === "before")) query.before = parseDay(value, now);
    else if (token.startsWith("@") && token.length > 1) query.people.push(token.slice(1));
    else if (token.startsWith("#") && parseFragmentRef(token)) query.refs.push(parseFragmentRef(token) ?? "");
    else if (parseFragmentNumber(token) !== null) query.numbers.push(parseFragmentNumber(token) ?? 0);
    else words.push(token);
  }
  query.text = words.join(" ");
  return query;
}

/** Nothing to search for. */
export function isEmptySearch(q: SearchQuery): boolean {
  return !q.text && q.phrases.length === 0 && q.people.length === 0 && q.refs.length === 0 && q.numbers.length === 0 && !q.drawer && !q.nature;
}
