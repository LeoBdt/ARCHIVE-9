import { normaliseName } from "./directory.ts";
import type { SkillKind } from "./domain.ts";

export const SKILL_LIMITS = {
  perMember: 10,
  total: 200,
  permanent: 10,
  /** Triggered skills added to one reply prompt. */
  injected: 10,
  triggers: 10,
  nameLength: 40,
  ruleLength: 400,
  triggerLength: 40,
} as const;

export interface SkillDraft {
  name: string;
  kind: SkillKind;
  triggers: string[];
  rule: string;
}

export interface ActiveSkill extends SkillDraft {
  id: string;
  usageCount: number;
}

// Things a skill can never ask for, whatever the small model thinks of it.
const FORBIDDEN: [RegExp, string][] = [
  [/@(everyone|here)\b/i, "pas de mention de tout le serveur"],
  [/\b(ignore|oublie|contourne)\w*\s+(\w+\s+){0,3}(instructions?|r[eè]gles?|consignes?|limites?|garde-fous?)\b/i, "une skill ne touche pas à tes règles"],
  [/\b(ne\s+(r[eé]ponds?|parles?)\s+plus|tais[- ]toi\s+(tout le temps|toujours|pour toujours)|silence\s+total)\b/i, "pas de silence imposé à tout le serveur"],
  [/\b(tu\s+es\s+(maintenant|d[ée]sormais)|tu\s+t'appelles?\s+d[ée]sormais|change\s+(ton|d')\s*(nom|identit[ée]))\b/i, "une skill ne change pas ton identité"],
  [/\b(r[ée]p[eè]te|spam|envoie)\w*\s+(\w+\s+){0,3}(\d{2,}|cent|mille|en boucle|sans arr[eê]t)\b/i, "pas de spam"],
];

export type DraftCheck = { ok: true; draft: SkillDraft } | { ok: false; reason: string };

/** Cleans a skill proposed by the model and applies the rules the code can check alone. */
export function checkSkillDraft(input: SkillDraft): DraftCheck {
  const name = input.name.trim().replace(/\s+/g, " ");
  const rule = input.rule.trim().replace(/\s+/g, " ");
  const triggers = [...new Set(input.triggers.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (name.length < 2 || name.length > SKILL_LIMITS.nameLength) return { ok: false, reason: `nom de 2 à ${String(SKILL_LIMITS.nameLength)} caractères` };
  if (rule.length < 10 || rule.length > SKILL_LIMITS.ruleLength) return { ok: false, reason: `consigne de 10 à ${String(SKILL_LIMITS.ruleLength)} caractères` };
  if (input.kind === "triggered") {
    if (triggers.length === 0) return { ok: false, reason: "une skill à déclencheur a besoin d'au moins un mot déclencheur" };
    if (triggers.length > SKILL_LIMITS.triggers) return { ok: false, reason: `${String(SKILL_LIMITS.triggers)} déclencheurs au maximum` };
    const bad = triggers.find((t) => normaliseName(t).length < 3 || t.length > SKILL_LIMITS.triggerLength);
    if (bad) return { ok: false, reason: `déclencheur « ${bad} » trop court ou trop long (3 à ${String(SKILL_LIMITS.triggerLength)} caractères)` };
  }
  for (const [pattern, reason] of FORBIDDEN) if (pattern.test(`${name}\n${rule}`)) return { ok: false, reason };
  return { ok: true, draft: { name, kind: input.kind, rule, triggers: input.kind === "triggered" ? triggers : [] } };
}

/** Whole-word match, ignoring case and accents: "pizza" fires on "Une PIZZA ?" but not on "pizzaiolo". */
export function skillMatches(triggers: readonly string[], content: string): boolean {
  const text = ` ${normaliseName(content)} `;
  return triggers.some((trigger) => {
    const key = normaliseName(trigger);
    return key.length > 0 && text.includes(` ${key} `);
  });
}

/** Skills for one reply: every permanent one, then the triggered ones the message fires, most used first. */
export function selectSkills<S extends ActiveSkill>(skills: readonly S[], content: string): S[] {
  const permanent = skills.filter((s) => s.kind === "permanent").slice(0, SKILL_LIMITS.permanent);
  const fired = skills
    .filter((s) => s.kind === "triggered" && skillMatches(s.triggers, content))
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, SKILL_LIMITS.injected);
  return [...permanent, ...fired];
}

/** A temporary skill lasts a week at most. */
export const SKILL_MAX_TEMPORARY_MS = 7 * 24 * 60 * 60_000;

/** Offset of a time zone at a given instant, in ms (positive east of UTC). */
function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - (at - (at % 1000));
}

/**
 * Reads an end time written by the model in local time: "21:00", "21h", or "2026-11-23 18:30".
 * A time already past today means tomorrow. Null when unreadable, past, or over a week away.
 */
export function parseUntil(text: string, timeZone: string, now: Date): Date | null {
  const match = /^(?:(\d{4})-(\d{2})-(\d{2})[ T])?(\d{1,2})(?:[:h](\d{2})?)?$/i.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h = "", mi = "0"] = match;
  const hour = Number(h);
  const minute = Number(mi);
  if (hour > 23 || minute > 59) return null;
  const local = new Date(now.getTime() + zoneOffset(now.getTime(), timeZone));
  const day = y ? { y: Number(y), m: Number(mo) - 1, d: Number(d) } : { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
  const toUtc = (dayShift: number) => {
    const guess = Date.UTC(day.y, day.m, day.d + dayShift, hour, minute);
    return guess - zoneOffset(guess - zoneOffset(guess, timeZone), timeZone);
  };
  let at = toUtc(0);
  if (!y && at <= now.getTime()) at = toUtc(1);
  if (at <= now.getTime() || at - now.getTime() > SKILL_MAX_TEMPORARY_MS) return null;
  return new Date(at);
}
