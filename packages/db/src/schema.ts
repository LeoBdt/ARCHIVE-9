import {
  ACTION_STATUSES,
  ACTION_TIERS,
  AI_CALL_STATUSES,
  AI_TASKS,
  FACT_NATURES,
  SELF_STATE_SOURCES,
  SKILL_KINDS,
  type MessageReactions,
  type NameHistoryEntry,
  type SelfState,
} from "@archive-9/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const timestamptz = () => timestamp({ withTimezone: true });
const createdAt = () => timestamptz().notNull().defaultNow();

export const factNature = pgEnum("fact_nature", FACT_NATURES);
export const aiTask = pgEnum("ai_task", AI_TASKS);
export const aiCallStatus = pgEnum("ai_call_status", AI_CALL_STATUSES);
export const actionTier = pgEnum("action_tier", ACTION_TIERS);
export const actionStatus = pgEnum("action_status", ACTION_STATUSES);
export const selfStateSource = pgEnum("self_state_source", SELF_STATE_SOURCES);
export const skillKind = pgEnum("skill_kind", SKILL_KINDS);

export const members = pgTable("members", {
  id: text().primaryKey(),
  username: text().notNull(),
  displayName: text(),
  nameHistory: jsonb().$type<NameHistoryEntry[]>().notNull().default([]),
  isBot: boolean().notNull().default(false),
  isKnownAiBot: boolean().notNull().default(false),
  /** The row holding the server's own profile, keyed by the guild ID. */
  isServer: boolean().notNull().default(false),
  /** On the server right now, kept by the bot: the site only lets these people in. */
  inGuild: boolean().notNull().default(false),
  /** Discord avatar hash, for the site's pictures. */
  avatar: text(),
  optedOutAt: timestamptz(),
  /** Asked for their DMs to stay out of its memory (/mp-prives). */
  dmPrivateAt: timestamptz(),
  /** Told once, in a first DM, that DMs are archived like the rest. */
  dmNoticeAt: timestamptz(),
  /** When the evening tidy last went through their dossier. */
  tidiedAt: timestamptz(),
  firstSeenAt: createdAt(),
  lastSeenAt: createdAt(),
});

export const messages = pgTable(
  "messages",
  {
    id: text().primaryKey(),
    guildId: text(),
    channelId: text().notNull(),
    authorId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    content: text().notNull(),
    replyToId: text(),
    mentionedIds: text().array().notNull().default(sql`'{}'::text[]`),
    reactions: jsonb().$type<MessageReactions>().notNull().default({}),
    createdAt: timestamptz().notNull(),
    editedAt: timestamptz(),
    analysedAt: timestamptz(),
  },
  (t) => [
    index().on(t.channelId, t.createdAt),
    index().on(t.authorId),
    index("messages_pending_analysis_idx").on(t.createdAt).where(sql`${t.analysedAt} is null`),
    index().on(t.createdAt),
  ],
);

/** The drawers facts are filed in: the starting ones, and those ARCHIVE-9 created. */
export const factCategories = pgTable("fact_categories", {
  key: text().primaryKey(),
  label: text().notNull(),
  color: text().notNull(),
  /** A drawer made for one person only; null for a drawer everyone shares. */
  memberId: text().references(() => members.id, { onDelete: "cascade" }),
  /** "system" for the starting drawers, "archive-9" for its own. */
  createdBy: text().notNull().default("system"),
  /** Why ARCHIVE-9 opened it. */
  reason: text(),
  createdAt: createdAt(),
});

export const profileFacts = pgTable(
  "profile_facts",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Reference shown as #K7QX3M, drawn by the database, kept by every later version. */
    ref: text().notNull().default(sql`a9_fragment_ref()`),
    /** Arrival order in the dossier, kept by later versions; the F shown is the rank among current ones. 0 lets the database pick. */
    number: integer().notNull().default(0),
    memberId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    category: text()
      .notNull()
      .references(() => factCategories.key, { onUpdate: "cascade" }),
    content: text().notNull(),
    confidence: real().notNull(),
    nature: factNature().notNull(),
    sourceMessageIds: text().array().notNull().default(sql`'{}'::text[]`),
    reportedBy: text().references(() => members.id, { onDelete: "cascade" }),
    supersededBy: uuid().references((): AnyPgColumn => profileFacts.id, { onDelete: "set null" }),
    deletedAt: timestamptz(),
    deletedBy: text(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    check("profile_facts_confidence_range", sql`${t.confidence} between 0 and 1`),
    index("profile_facts_current_idx")
      .on(t.memberId)
      .where(sql`${t.supersededBy} is null and ${t.deletedAt} is null`),
    index().on(t.createdAt),
    uniqueIndex("profile_facts_ref_idx").on(t.ref).where(sql`${t.supersededBy} is null and ${t.deletedAt} is null`),
    index().on(t.memberId, t.number),
    index("profile_facts_sources_idx").using("gin", t.sourceMessageIds),
  ],
);

/** Facts a member took off their own profile, with why: never learned again from scratch. */
export const factCorrections = pgTable(
  "fact_corrections",
  {
    id: uuid().primaryKey().defaultRandom(),
    memberId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    factId: uuid().references(() => profileFacts.id, { onDelete: "set null" }),
    /** The removed fact, kept as it was. */
    content: text().notNull(),
    /** The member's own version, when they corrected it instead of removing it. */
    newContent: text(),
    reason: text().notNull(),
    /** Where it was asked: "discord" or "site". */
    source: text().notNull(),
    /** Who did it, when it isn't the member (an admin on the site). */
    by: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.memberId, t.createdAt), index().on(t.factId)],
);

export const profileSummaries = pgTable("profile_summaries", {
  memberId: text()
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  summary: text().notNull(),
  /** One line in ARCHIVE-9's voice, shown to the member. */
  tagline: text(),
  factCount: integer().notNull(),
  model: text().notNull(),
  generatedAt: createdAt(),
});

export const relationships = pgTable(
  "relationships",
  {
    memberId: text()
      .primaryKey()
      .references(() => members.id, { onDelete: "cascade" }),
    affinity: numeric({ precision: 4, scale: 1, mode: "number" }).notNull().default(0),
    trust: numeric({ precision: 4, scale: 1, mode: "number" }).notNull().default(25),
    feeling: text(),
    howTheyTreatMe: text(),
    interactionCount: integer().notNull().default(0),
    introducedAt: timestamptz(),
    lastInteractionAt: timestamptz(),
    updatedAt: createdAt(),
  },
  (t) => [
    check("relationships_affinity_range", sql`${t.affinity} between -50 and 50`),
    check("relationships_trust_range", sql`${t.trust} between 0 and 50`),
  ],
);

export const relationshipEvents = pgTable(
  "relationship_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    memberId: text()
      .notNull()
      .references(() => relationships.memberId, { onDelete: "cascade" }),
    affinityDelta: numeric({ precision: 3, scale: 1, mode: "number" }).notNull(),
    trustDelta: numeric({ precision: 3, scale: 1, mode: "number" }).notNull(),
    reason: text().notNull(),
    sourceMessageId: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.memberId, t.createdAt)],
);

export const selfStateVersions = pgTable("self_state_versions", {
  version: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** The number shown to people, in half steps: midday is N, the evening N,5. */
  label: numeric({ precision: 7, scale: 1, mode: "number" }).notNull(),
  state: jsonb().$type<SelfState>().notNull(),
  source: selfStateSource().notNull(),
  createdBy: text(),
  createdAt: createdAt(),
});

/** What members told ARCHIVE-9 about how it behaves. The evening reflection weighs it. */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    content: text().notNull(),
    sourceMessageId: text(),
    createdAt: createdAt(),
    /** Read by a reflection: no longer shown in every reply. */
    reviewedAt: timestamptz(),
    /** What the reflection decided: adopted, partial or ignored, and why. */
    verdict: text(),
    verdictReason: text(),
    /** The version of itself that weighed it. */
    reviewedLabel: numeric({ precision: 7, scale: 1, mode: "number" }),
    /** "discord", or "site" for an admin's comment on its mind. */
    source: text().notNull().default("discord"),
    /** What it was about, for a comment from the site (« blague : … »). */
    about: text(),
  },
  (t) => [index().on(t.createdAt)],
);

/** How a member wants to be treated, asked by them: only used when they take part. */
export const memberPreferences = pgTable(
  "member_preferences",
  {
    id: uuid().primaryKey().defaultRandom(),
    memberId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    content: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.memberId)],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    kind: skillKind().notNull(),
    /** Words spotted by the code in a message (triggered skills only). */
    triggers: text().array().notNull().default(sql`'{}'::text[]`),
    rule: text().notNull(),
    authorId: text().references(() => members.id, { onDelete: "set null" }),
    usageCount: integer().notNull().default(0),
    lastUsedAt: timestamptz(),
    /** A temporary skill stops applying after this. */
    expiresAt: timestamptz(),
    /** Scope: only in this channel, or only with this member. */
    channelId: text(),
    memberId: text(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
    deletedAt: timestamptz(),
    deletedBy: text(),
  },
  (t) => [uniqueIndex("skills_active_name_idx").on(sql`lower(${t.name})`).where(sql`${t.deletedAt} is null`)],
);

/** Earlier versions of a skill, kept when it is edited. */
export const skillRevisions = pgTable(
  "skill_revisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    skillId: uuid()
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: skillKind().notNull(),
    triggers: text().array().notNull().default(sql`'{}'::text[]`),
    rule: text().notNull(),
    channelId: text(),
    memberId: text(),
    /** Who replaced this version, and when. */
    editedBy: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.skillId, t.createdAt)],
);

export const actionsLog = pgTable(
  "actions_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    tool: text().notNull(),
    tier: actionTier().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull(),
    status: actionStatus().notNull(),
    refusalReason: text(),
    previousValue: jsonb().$type<Record<string, unknown>>(),
    requestedBy: text().references(() => members.id, { onDelete: "set null" }),
    sourceMessageId: text(),
    undoneAt: timestamptz(),
    undoneBy: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.createdAt), index().on(t.tool, t.createdAt)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid().notNull(),
    task: aiTask().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    /** The model that really answered, when a router picked it (openrouter/free…). */
    servedModel: text(),
    upstreamProvider: text(),
    fallbackReason: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    reasoningTokens: integer().notNull().default(0),
    costUsd: numeric({ precision: 12, scale: 8, mode: "number" }),
    durationMs: integer().notNull(),
    status: aiCallStatus().notNull(),
    error: text(),
    detail: text(),
    replyMessageIds: text().array().notNull().default(sql`'{}'::text[]`),
    /** Version of the bot that made the call (« Novahe (a1b2c3d) »). */
    version: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.createdAt),
    index().on(t.runId),
    index("ai_usage_reply_message_ids_idx").using("gin", t.replyMessageIds),
  ],
);

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: text(),
  updatedAt: createdAt(),
});

// Site login (Better Auth). Discord gives only the identity: no real email, no OAuth token kept.
export const webUser = pgTable("web_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  /** Placeholder built from the Discord ID: Better Auth needs one, the site never asks for it. */
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  discordId: text().notNull().unique(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

export const webSession = pgTable(
  "web_session",
  {
    id: text().primaryKey(),
    expiresAt: timestamptz().notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => webUser.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const webAccount = pgTable("web_account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => webUser.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamptz(),
  refreshTokenExpiresAt: timestamptz(),
  scope: text(),
  password: text(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

export const webVerification = pgTable("web_verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamptz().notNull(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

/** Site admins, chosen by the site owner (SITE_OWNER_ID), who is always one. */
export const siteAdmins = pgTable("site_admins", {
  memberId: text()
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  grantedBy: text().notNull(),
  createdAt: createdAt(),
});

export interface DecisionDetails {
  /** What it had in mind: relation with the author, skills, preferences, resolutions… */
  context?: string[];
  reasoning?: string | null;
  steps?: { tool: string; summary: string }[];
  /** What it sent, joined. */
  sent?: string | null;
  /** The triage that led here: what it read and how it reasoned. */
  triage?: {
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
  } | null;
  /** People it had in mind, to link their dossier and show the numbers. */
  people?: { id: string; name: string; affinity: number | null; trust: number | null; feeling: string | null }[];
  /** Skills given to the reply, to link them. */
  skills?: string[];
  /** Its short memory of the author (messages elsewhere lately) and its mood then. */
  memory?: { messages: number; places: string[]; mood: string };
  /** A DM of someone who made them private (/mp-prives): only they see it, admins included. */
  private?: boolean;
}

/** Every message ARCHIVE-9 looked at, and what it decided. Kept 14 days. Feeds the journal and the backstage page. */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid(),
    messageId: text().notNull(),
    channelId: text().notNull(),
    channelName: text(),
    guildId: text(),
    authorId: text().notNull(),
    /** ignored, silent, replied, reacted or offline. */
    outcome: text().notNull(),
    reason: text(),
    addressed: boolean().notNull().default(false),
    inAgents: boolean().notNull().default(false),
    interest: smallint(),
    /** The message it reacted to, cut short. Empty for ignored ones. */
    content: text(),
    details: jsonb().$type<DecisionDetails>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.createdAt), index().on(t.outcome, t.createdAt)],
);

export interface RequestStep {
  at: string;
  /** step: what it does; say: what it tells you; error: what went wrong. */
  kind: "step" | "say" | "error";
  text: string;
}

/** Something asked from the site that ARCHIVE-9 handles itself, with each step shown live. */
export const siteRequests = pgTable(
  "site_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** fact_edit, fact_remove, mind_comment, skill_create or skill_edit. */
    kind: text().notNull(),
    requesterId: text().notNull(),
    /** The member, fact or skill it is about. */
    targetId: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    /** pending, running, done or failed. */
    status: text().notNull().default("pending"),
    steps: jsonb().$type<RequestStep[]>().notNull().default([]),
    result: jsonb().$type<Record<string, unknown>>(),
    costUsd: numeric({ precision: 12, scale: 8, mode: "number" }),
    createdAt: createdAt(),
    finishedAt: timestamptz(),
  },
  (t) => [index().on(t.status, t.createdAt), index().on(t.createdAt)],
);

export interface ReleaseItem {
  text: string;
  sha: string;
}

/** A version of the bot (core) or of the site, with what changed, written for the server. */
export const releases = pgTable(
  "releases",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    /** « Mirys » for the core, « 1.2.0 » for the site. */
    label: text().notNull(),
    sha: text().notNull(),
    previousSha: text(),
    comment: text(),
    items: jsonb().$type<ReleaseItem[]>().notNull().default([]),
    commits: jsonb().$type<{ sha: string; title: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("releases_kind_sha_idx").on(t.kind, t.sha), index().on(t.kind, t.createdAt)],
);

export interface FactOperationDetails {
  /** The fragment's text before, for a rewrite, a merge or a deletion. */
  before?: string;
  after?: string;
  from?: string;
  to?: string;
  /** Fragments folded into this one by a merge. */
  merged?: { id: string; ref: string; content: string }[];
  /** A drawer opened for this person. */
  drawer?: { key: string; label: string };
}

/**
 * Everything the tidy did or wanted to do to fragments: moves, rewrites, merges, deletions,
 * personal drawers. In dry run, merges and deletions wait here as `planned`.
 */
export const factOperations = pgTable(
  "fact_operations",
  {
    id: uuid().primaryKey().defaultRandom(),
    memberId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    factId: uuid().references(() => profileFacts.id, { onDelete: "set null" }),
    /** move, rewrite, merge, delete or drawer. */
    op: text().notNull(),
    /** done, planned, applied (a planned one, later), dismissed, or failed. */
    status: text().notNull(),
    reason: text().notNull(),
    details: jsonb().$type<FactOperationDetails>().notNull().default({}),
    /** nightly, cleanup (the one-shot big tidy) or analysis. */
    run: text().notNull(),
    createdAt: createdAt(),
    decidedAt: timestamptz(),
    decidedBy: text(),
  },
  (t) => [index().on(t.createdAt), index().on(t.status, t.createdAt), index().on(t.memberId)],
);

/** What ARCHIVE-9 understood of each image or GIF it saw, described once. */
export const messageImages = pgTable(
  "message_images",
  {
    /** The attachment ID, or the message ID and position for an embed. */
    id: text().primaryKey(),
    messageId: text()
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    url: text().notNull(),
    /** image, gif or embed (Tenor, Giphy…). */
    kind: text().notNull(),
    name: text(),
    description: text(),
    model: text(),
    error: text(),
    createdAt: createdAt(),
    describedAt: timestamptz(),
  },
  (t) => [index().on(t.messageId), index("message_images_pending_idx").on(t.createdAt).where(sql`${t.describedAt} is null`)],
);

/**
 * Its notebook for its creator: what it lacks (gap) and what it would like to change in
 * itself (wish). The owner answers each note; it reads the answers in its evening reflection.
 */
export const capabilityGaps = pgTable(
  "capability_gaps",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** gap or wish. */
    kind: text().notNull().default("gap"),
    content: text().notNull(),
    /** What happened that showed it. */
    reason: text(),
    label: numeric({ precision: 7, scale: 1, mode: "number" }),
    /** reflection, or conversation when it noted it while talking. */
    source: text().notNull().default("reflection"),
    /** open, done, declined or later. */
    status: text().notNull().default("open"),
    answer: text(),
    answeredAt: timestamptz(),
    answeredBy: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.createdAt), index().on(t.status)],
);
