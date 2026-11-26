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
  "background",
  "opinions",
  "other",
] as const;
/** The drawers every server starts with. ARCHIVE-9 can add its own, so a category is any key. */
export type BaseCategory = (typeof FACT_CATEGORIES)[number];
export type FactCategory = string;

/** Label and colour of the starting drawers, as the site shows them. */
export const BASE_CATEGORY_INFO: Record<BaseCategory, { label: string; color: string }> = {
  identity: { label: "Identité", color: "#e9e9ee" },
  tastes: { label: "Goûts", color: "#ff9f5a" },
  games: { label: "Jeux", color: "#7cc4ff" },
  humor: { label: "Humour", color: "#f5c04a" },
  habits: { label: "Habitudes", color: "#5ad1c9" },
  projects: { label: "Projets", color: "#6ee7a8" },
  relationships: { label: "Liens", color: "#ff4757" },
  anecdotes: { label: "Anecdotes", color: "#ff7ab6" },
  in_jokes: { label: "Blagues internes", color: "#c4a0ff" },
  writing_style: { label: "Façon d'écrire", color: "#a0b4ff" },
  background: { label: "Parcours", color: "#d6b38a" },
  opinions: { label: "Avis", color: "#9be36b" },
  other: { label: "Divers", color: "#b9b9c3" },
};

/** Colours given in turn to the drawers ARCHIVE-9 creates. */
export const NEW_CATEGORY_COLORS = ["#e6a1ff", "#ffcf7a", "#7ae0ff", "#ff9a8a", "#b0f0d0", "#a3a8ff", "#f0a8c8", "#c8e07a"];

export interface CategoryInfo {
  key: string;
  label: string;
  color: string;
}

export const FACT_NATURES = ["fact", "reported", "probable_joke", "inference"] as const;
export type FactNature = (typeof FACT_NATURES)[number];

export const AI_TASKS = ["triage", "reply", "analysis", "reflection", "vision", "embedding"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_CALL_STATUSES = ["ok", "rate_limited", "error"] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

export const ACTION_TIERS = ["free", "controlled"] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

export const ACTION_STATUSES = ["done", "refused", "failed", "undone", "pending", "cancelled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const SELF_STATE_SOURCES = ["initial", "reflection", "rollback", "midday"] as const;
export type SelfStateSource = (typeof SELF_STATE_SOURCES)[number];

export const SKILL_KINDS = ["triggered", "permanent"] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export const AFFINITY_RANGE = { min: -50, max: 50 } as const;
export const TRUST_RANGE = { min: 0, max: 50 } as const;
/** Where trust starts with someone new. */
export const TRUST_START = 25;

export interface SelfState {
  mood: string;
  opinions: string[];
  runningJokes: string[];
  notes: string;
  /** What it decided to change in how it behaves, after members' feedback. */
  resolutions?: string[];
  /** The face it shows on the site, picked by the reflection. */
  icon?: MoodIcon;
}

export const MOOD_ICONS = ["neutral", "amused", "curious", "tired", "annoyed", "glitch"] as const;
export type MoodIcon = (typeof MOOD_ICONS)[number];

export interface NameHistoryEntry {
  name: string;
  seenAt: string;
}

export type MessageReactions = Record<string, number>;
