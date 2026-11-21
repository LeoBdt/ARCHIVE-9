export const FACT_CATEGORIES = [
  "identity",
  "tastes",
  "games",
  "humor",
  "habits",
  "projects",
  "relationships",
  "anecdotes",
  "in_jokes",
  "writing_style",
  "other",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const FACT_NATURES = ["fact", "reported", "probable_joke", "inference"] as const;
export type FactNature = (typeof FACT_NATURES)[number];

export const AI_TASKS = ["triage", "reply", "analysis", "reflection"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_CALL_STATUSES = ["ok", "rate_limited", "error"] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

export const ACTION_TIERS = ["free", "controlled"] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

export const ACTION_STATUSES = ["done", "refused", "failed", "undone"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const SELF_STATE_SOURCES = ["initial", "reflection", "rollback"] as const;
export type SelfStateSource = (typeof SELF_STATE_SOURCES)[number];

export const AFFINITY_RANGE = { min: -100, max: 100 } as const;
export const TRUST_RANGE = { min: 0, max: 100 } as const;

export interface SelfState {
  mood: string;
  opinions: string[];
  runningJokes: string[];
  notes: string;
}

export interface NameHistoryEntry {
  name: string;
  seenAt: string;
}

export type MessageReactions = Record<string, number>;
