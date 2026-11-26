export interface Viewer {
  id: string;
  name: string;
  avatar: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  optedOut: boolean;
}

export type FeedKind = "learned" | "action" | "skill" | "relation" | "memory" | "system";
export type MoodIcon = "neutral" | "amused" | "curious" | "tired" | "annoyed" | "glitch";
export type SelfSource = "initial" | "reflection" | "rollback" | "midday";

export interface Home {
  counts: { messages: number; facts: number; dossiers: number; skills: number };
  closest: { id: string; name: string; isBot: boolean; avatar: string | null; tagline: string | null; affinity: number; trust: number; messages: number; facts: number }[];
  skills: { name: string; kind: "triggered" | "permanent"; rule: string; author: string | null; uses: number; expiresAt: string | null }[];
  feed: { at: string; kind: FeedKind; text: string }[];
  mood: string | null;
  icon: MoodIcon | null;
  moodAt: string | null;
  moodSource: SelfSource | null;
  status: string | null;
  statusAt: string | null;
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

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${String(response.status)}`);
  return data;
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

export interface Category {
  key: string;
  label: string;
  color: string;
  createdBy?: string;
  createdAt?: string;
  /** Made for this dossier only. */
  personal?: boolean;
  reason?: string | null;
}

export interface DossierSummary {
  id: string;
  name: string;
  aliases: string[];
  isBot: boolean;
  avatar: string | null;
  tagline: string | null;
  affinity: number | null;
  trust: number | null;
  facts: number;
  messages: number;
  firstSeenAt: string;
  changedAt: string | null;
}

export interface Fact {
  id: string;
  category: string;
  nature: FactNature;
  confidence: number;
  content: string;
  reportedByName: string | null;
  source: string | null;
  sourceMessageId: string | null;
  /** #K7QX3M, never changes. */
  ref: string;
  /** Its rank among the current fragments (F001…). */
  number: number;
  createdAt: string;
  corrected: { at: string; by: string | null; reason: string } | null;
}

export interface RelationEvent {
  affinityDelta: number;
  trustDelta: number;
  reason: string;
  sourceMessageId: string | null;
  createdAt: string;
}

export interface Dossier {
  id: string;
  name: string;
  aliases: string[];
  isBot: boolean;
  avatar: string | null;
  isMine: boolean;
  canEdit: boolean;
  firstSeenAt: string;
  summary: string | null;
  tagline: string | null;
  summaryAt: string | null;
  messages: number;
  relationship: { affinity: number; trust: number; feeling: string | null; howTheyTreatMe: string | null } | null;
  facts: Fact[];
  categories: Category[];
  events: RelationEvent[];
  history: { day: string; affinity: number; trust: number }[];
  changedAt: string | null;
}

export interface MessageContext {
  found: boolean;
  isDm?: boolean;
  hidden?: boolean;
  channelName?: string | null;
  link?: string | null;
  at?: string;
  messages?: { id: string; author: string; content: string; at: string; isTarget: boolean }[];
}

export interface Relations {
  people: { id: string; name: string; isBot: boolean; avatar: string | null; affinity: number; trust: number; feeling: string | null; week: number; weekTrust: number; changedAt: string }[];
  moves: { memberId: string; name: string; avatar: string | null; affinityDelta: number; trustDelta: number; reason: string; sourceMessageId: string | null; createdAt: string }[];
}

export interface SelfStateView {
  mood: string;
  opinions: string[];
  runningJokes: string[];
  notes: string;
  resolutions?: string[];
  icon?: MoodIcon;
}

export interface Esprit {
  history: { version: number; label: number; state: SelfStateView; source: SelfSource; createdAt: string }[];
  pending: { id: string; author: string; content: string; about: string | null; source: string; createdAt: string }[];
  reviewed: {
    id: string;
    author: string;
    content: string;
    about: string | null;
    source: string;
    verdict: "adopted" | "partial" | "ignored" | null;
    verdictReason: string | null;
    reviewedLabel: number | null;
    reviewedAt: string;
    createdAt: string;
  }[];
  status: string | null;
  version: { label: string; startedAt: string } | null;
  reflectionHours: { midday: number; evening: number };
  paused: boolean;
}

export interface SkillView {
  id: string;
  name: string;
  kind: "triggered" | "permanent";
  triggers: string[];
  rule: string;
  authorId: string | null;
  author: string | null;
  channelId: string | null;
  channelName: string | null;
  memberId: string | null;
  memberName: string | null;
  uses: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  revisions: number;
  canEdit: boolean;
}

export interface SkillRevision {
  name: string;
  kind: string;
  triggers: string[];
  rule: string;
  editedBy: string | null;
  createdAt: string;
}

export interface RequestView {
  id: string;
  kind: string;
  status: "pending" | "running" | "done" | "failed";
  steps: { at: string; kind: "step" | "say" | "error"; text: string }[];
  result: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface TriageDetails {
  transcript: string;
  reasoning: string | null;
  addressed: boolean;
  interest: number;
  reason: string;
  model: string | null;
  fallbackReason: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ReplyEntry {
  id: string;
  outcome: "replied" | "reacted" | "silent" | "offline";
  reason: string | null;
  channelName: string | null;
  isDm: boolean;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  content: string | null;
  link: string | null;
  details: {
    context?: string[];
    reasoning?: string | null;
    steps?: { tool: string; summary: string }[];
    sent?: string | null;
    triage?: TriageDetails | null;
    people?: { id: string; name: string; avatar: string | null; affinity: number | null; trust: number | null; feeling: string | null }[];
    skills?: string[];
    memory?: { messages: number; places: string[]; mood: string };
  } | null;
  createdAt: string;
  usage: {
    model: string | null;
    provider: string | null;
    version: string | null;
    fallbackReason: string | null;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    costUsd: number;
    durationMs: number;
    calls: number;
  } | null;
}

interface Quote {
  messageId: string;
  author: string | null;
  channelName: string | null;
  at: string | null;
  content: string | null;
  link: string | null;
}

export type LearnedEntry =
  | {
      kind: "fact" | "correction";
      at: string;
      memberId: string;
      name: string;
      avatar: string | null;
      factId: string;
      number: number;
      current: boolean;
      category: Category;
      nature: FactNature;
      confidence: number;
      content: string;
      reporter: string | null;
      source: Quote | null;
      correction: { reason: string; source: string; by: string | null; before: string } | null;
    }
  | { kind: "removal"; at: string; memberId: string; name: string; avatar: string | null; content: string; reason: string; via: string; by: string | null }
  | { kind: "drawer"; at: string; category: Category; reason: string | null; count: number };

export interface ActionEntry {
  id: string;
  tool: string;
  tier: "free" | "controlled";
  params: Record<string, unknown>;
  status: "done" | "refused" | "failed" | "undone";
  refusalReason: string | null;
  requestedBy: string | null;
  createdAt: string;
  undoneAt: string | null;
}

export interface TriageView {
  counts: { total: number; replied: number; silent: number; ignored: number };
  ignored: { reason: string | null; n: number }[];
  rows: {
    id: string;
    outcome: string;
    reason: string | null;
    interest: number | null;
    addressed: boolean;
    channelName: string | null;
    isDm: boolean;
    authorName: string;
    details: { triage: TriageDetails } | null;
    createdAt: string;
  }[];
}

export interface ErrorAttempt {
  task: string;
  model: string;
  servedModel: string | null;
  provider: string;
  status: string;
  error: string | null;
  fallbackReason: string | null;
  detail: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  createdAt: string;
}

export interface ErrorGroup {
  task: string;
  model: string;
  error: string;
  from: string;
  to: string;
  attempts: ErrorAttempt[];
  next: ErrorAttempt | null;
}

export interface Release {
  id: string;
  kind: "core" | "site";
  label: string;
  sha: string;
  previousSha: string | null;
  comment: string | null;
  items: { text: string; sha: string }[];
  commits: { sha: string; title: string }[];
  createdAt: string;
}

export interface SystemView {
  daily: { day: string; task: string; costUsd: number; calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; errors: number }[];
  byModel: { task: string; model: string; provider: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; medianMs: number | null; errors: number; fallbacks: number; served: string[] | null }[];
  byPerson: { id: string; name: string; avatar: string | null; costUsd: number; replies: number }[];
  last24: { costUsd: number; replyCostUsd: number; calls: number; errors: number };
  speed: { median: number | null; p95: number | null };
  releases: { core: Release[]; site: Release[] };
  replyBudgetUsd: number;
  paused: boolean;
  version: { label: string; startedAt: string } | null;
}

export interface SettingsView {
  paused: boolean;
  spontaneity: number;
  showFallbackTag: boolean;
  listenedChannelIds: string[];
  reflectionHours: { midday: number; evening: number };
  tidyDryRun: boolean;
  channels: { id: string; name: string; category: string | null; isPublic?: boolean }[];
}

export interface AccessRow {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  isOwner: boolean;
}

export interface SearchFragment {
  id: string;
  ref: string;
  rank: number;
  memberId: string;
  memberName: string;
  avatar: string | null;
  category: string;
  categoryLabel: string | null;
  nature: FactNature;
  confidence: number;
  content: string;
  createdAt: string;
}

export interface SearchMessage {
  id: string;
  channelId: string;
  channelName: string | null;
  isDm: boolean;
  authorId: string;
  authorName: string;
  avatar: string | null;
  content: string;
  images: string[] | null;
  createdAt: string;
}

export interface SearchView {
  empty?: true;
  tookMs: number;
  people: { id: string; name: string }[];
  fragments: SearchFragment[];
  messages: SearchMessage[];
  dossiers: { id: string; name: string; username: string; avatar: string | null; tagline: string | null; facts: number }[];
  skills: { id: string; name: string; kind: string; rule: string; authorName: string | null; createdAt: string }[];
  journal: { id: string; messageId: string; channelName: string | null; authorName: string; content: string | null; sent: string | null; createdAt: string }[];
  relations: { memberId: string; memberName: string; affinityDelta: number; trustDelta: number; reason: string; createdAt: string }[];
  query: { text: string; phrases: string[] };
}

export interface FactOperationView {
  id: string;
  memberId: string;
  memberName: string;
  factId: string | null;
  ref: string | null;
  op: "move" | "rewrite" | "merge" | "delete" | "drawer";
  status: "done" | "planned" | "applied" | "dismissed" | "failed";
  reason: string;
  details: { before?: string; after?: string; from?: string; to?: string; merged?: { id: string; ref: string; content: string }[]; drawer?: { key: string; label: string } };
  run: "nightly" | "cleanup" | "analysis";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface NoteView {
  id: string;
  kind: "gap" | "wish";
  content: string;
  reason: string | null;
  label: number | null;
  source: "reflection" | "conversation";
  status: "open" | "done" | "declined" | "later";
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface TechniqueView {
  isOwner: boolean;
  tidyDryRun: boolean;
  feedback: { id: string; authorId: string; authorName: string; content: string; about: string | null; source: string; createdAt: string; reviewedAt: string | null; verdict: "adopted" | "partial" | "ignored" | null; verdictReason: string | null; reviewedLabel: number | null }[];
  operations: FactOperationView[];
  notes: NoteView[];
  drawers: { key: string; label: string; reason: string | null; owner: string | null; member_id: string | null; count: number; created_at: string }[];
  storage: { counts: Record<string, number | string | null>; tables: { name: string; bytes: number; rows: number }[] };
}
