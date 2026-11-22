import {
  ACTION_STATUSES,
  ACTION_TIERS,
  AI_CALL_STATUSES,
  AI_TASKS,
  FACT_CATEGORIES,
  FACT_NATURES,
  SELF_STATE_SOURCES,
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
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const timestamptz = () => timestamp({ withTimezone: true });
const createdAt = () => timestamptz().notNull().defaultNow();

export const factCategory = pgEnum("fact_category", FACT_CATEGORIES);
export const factNature = pgEnum("fact_nature", FACT_NATURES);
export const aiTask = pgEnum("ai_task", AI_TASKS);
export const aiCallStatus = pgEnum("ai_call_status", AI_CALL_STATUSES);
export const actionTier = pgEnum("action_tier", ACTION_TIERS);
export const actionStatus = pgEnum("action_status", ACTION_STATUSES);
export const selfStateSource = pgEnum("self_state_source", SELF_STATE_SOURCES);

export const members = pgTable("members", {
  id: text().primaryKey(),
  username: text().notNull(),
  displayName: text(),
  nameHistory: jsonb().$type<NameHistoryEntry[]>().notNull().default([]),
  isBot: boolean().notNull().default(false),
  isKnownAiBot: boolean().notNull().default(false),
  /** The row holding the server's own profile, keyed by the guild ID. */
  isServer: boolean().notNull().default(false),
  optedOutAt: timestamptz(),
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

export const profileFacts = pgTable(
  "profile_facts",
  {
    id: uuid().primaryKey().defaultRandom(),
    memberId: text()
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    category: factCategory().notNull(),
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
  ],
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
    affinity: smallint().notNull().default(0),
    trust: smallint().notNull().default(50),
    feeling: text(),
    howTheyTreatMe: text(),
    interactionCount: integer().notNull().default(0),
    introducedAt: timestamptz(),
    lastInteractionAt: timestamptz(),
    updatedAt: createdAt(),
  },
  (t) => [
    check("relationships_affinity_range", sql`${t.affinity} between -100 and 100`),
    check("relationships_trust_range", sql`${t.trust} between 0 and 100`),
  ],
);

export const relationshipEvents = pgTable(
  "relationship_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    memberId: text()
      .notNull()
      .references(() => relationships.memberId, { onDelete: "cascade" }),
    affinityDelta: smallint().notNull(),
    trustDelta: smallint().notNull(),
    reason: text().notNull(),
    sourceMessageId: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.memberId, t.createdAt)],
);

export const selfStateVersions = pgTable("self_state_versions", {
  version: integer().primaryKey().generatedAlwaysAsIdentity(),
  state: jsonb().$type<SelfState>().notNull(),
  source: selfStateSource().notNull(),
  createdBy: text(),
  createdAt: createdAt(),
});

export const skills = pgTable("skills", {
  id: uuid().primaryKey().defaultRandom(),
  trigger: text().notNull(),
  rule: text().notNull(),
  authorId: text().references(() => members.id, { onDelete: "set null" }),
  usageCount: integer().notNull().default(0),
  createdAt: createdAt(),
  deletedAt: timestamptz(),
  deletedBy: text(),
});

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
