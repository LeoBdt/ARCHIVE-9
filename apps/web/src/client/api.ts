export interface Viewer {
  id: string;
  name: string;
  isAdmin: boolean;
  isOwner: boolean;
  optedOut: boolean;
}

export type FeedKind = "learned" | "action" | "skill" | "relation" | "memory" | "system";

export interface Home {
  counts: { messages: number; facts: number; dossiers: number; skills: number };
  closest: { id: string; name: string; isBot: boolean; tagline: string | null; affinity: number; messages: number; facts: number }[];
  skills: { name: string; kind: "triggered" | "permanent"; rule: string; author: string | null; uses: number; expiresAt: string | null }[];
  feed: { at: string; kind: FeedKind; text: string }[];
  mood: string | null;
  status: string | null;
  paused: boolean;
  version: { label: string; startedAt: string } | null;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.status = status;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) throw new HttpError(response.status);
  return (await response.json()) as T;
}

/** Starts the Discord login; Better Auth answers with the URL to go to. */
export async function signIn(): Promise<void> {
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "discord", callbackURL: "/", errorCallbackURL: "/acces?erreur=1" }),
  });
  const body = (await response.json()) as { url?: string };
  if (body.url) window.location.assign(body.url);
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  window.location.assign("/acces");
}

export type FactNature = "fact" | "reported" | "probable_joke" | "inference";

export interface DossierSummary {
  id: string;
  name: string;
  isBot: boolean;
  tagline: string | null;
  affinity: number | null;
  facts: number;
  messages: number;
  lastSeenAt: string;
}

export interface Dossier {
  id: string;
  name: string;
  aliases: string[];
  isBot: boolean;
  isMine: boolean;
  firstSeenAt: string;
  summary: string | null;
  tagline: string | null;
  messages: number;
  relationship: { affinity: number; trust: number; feeling: string | null; howTheyTreatMe: string | null } | null;
  facts: { id: string; category: string; nature: FactNature; confidence: number; content: string; reportedByName: string | null; source: string | null; createdAt: string }[];
  events: { affinityDelta: number; trustDelta: number; reason: string; createdAt: string }[];
  affinityHistory: number[];
}

export interface Relations {
  people: { id: string; name: string; isBot: boolean; affinity: number; trust: number; feeling: string | null; week: number }[];
  moves: { name: string; affinityDelta: number; trustDelta: number; reason: string; createdAt: string }[];
}

export interface SelfStateView {
  mood: string;
  opinions: string[];
  runningJokes: string[];
  notes: string;
  resolutions?: string[];
}

export interface Memory {
  history: { version: number; state: SelfStateView; source: "initial" | "reflection" | "rollback"; createdAt: string }[];
  pending: { author: string; content: string; createdAt: string }[];
  status: string | null;
  version: { label: string; startedAt: string } | null;
}

export interface SkillView {
  id: string;
  name: string;
  kind: "triggered" | "permanent";
  triggers: string[];
  rule: string;
  author: string | null;
  uses: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ReplyEntry {
  id: string;
  outcome: "replied" | "reacted" | "silent" | "offline";
  reason: string | null;
  channelName: string | null;
  isDm: boolean;
  authorName: string;
  content: string | null;
  details: { context?: string[]; reasoning?: string | null; steps?: { tool: string; summary: string }[]; sent?: string | null } | null;
  createdAt: string;
  usage: { model: string | null; provider: string | null; fallbackReason: string | null; inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number; durationMs: number } | null;
}

export interface Backstage {
  today: { seen: number; replies: number; medianMs: number | null; spentToday: number };
  triage: { outcome: "ignored" | "silent"; reason: string | null; interest: number | null; channelName: string | null; isDm: boolean; authorName: string | null; createdAt: string }[];
  costs: { day: string; task: string; costUsd: number }[];
  ignored: { reason: string | null; n: number }[];
  errors: { model: string; task: string; status: string; fallbackReason: string | null; createdAt: string }[];
  paused: boolean;
}

export interface SettingsView {
  paused: boolean;
  spontaneity: number;
  showFallbackTag: boolean;
  listenedChannelIds: string[];
  channels: { id: string; name: string; category: string | null }[];
}

export interface AccessRow {
  id: string;
  name: string;
  isAdmin: boolean;
  isOwner: boolean;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${String(response.status)}`);
  return data;
}

export interface Journal {
  replies: ReplyEntry[];
  actions: { id: string; tool: string; tier: "free" | "controlled"; params: Record<string, unknown>; status: "done" | "refused" | "failed" | "undone"; refusalReason: string | null; requestedBy: string | null; createdAt: string; undoneAt: string | null }[];
  events: Home["feed"];
}
