import { DEFAULT_REFLECTION_HOURS, type ReflectionHours } from "@archive-9/core";
import { sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { settings } from "../schema.ts";

export interface BotSettings {
  paused: boolean;
  /** 0 observer, 1 discreet, 2 normal, 3 chatty. */
  spontaneity: number;
  showFallbackTag: boolean;
  listenedChannelIds: string[];
  debounceMs: number;
  /** Profile status lines, newest first: the current one, then a few to avoid repeats. */
  statusLines: string[];
  /** When the current status line was written. */
  statusAt: string | null;
  /** Local hours of the midday and evening reflections. */
  reflectionHours: ReflectionHours;
  /** Written by the bot at start-up, read by the site. */
  botVersion: { label: string; startedAt: string } | null;
  /** The server's text channels, published by the bot so the site can name them. */
  channelDirectory: { id: string; name: string; category: string | null; isPublic?: boolean }[];
  /** The tidy only proposes merges and deletions; an admin applies them from the site. */
  tidyDryRun: boolean;
  /** The face its Discord avatar shows now. */
  avatarFace: string | null;
}

const KEYS = {
  paused: "paused",
  spontaneity: "spontaneity",
  showFallbackTag: "show_fallback_tag",
  listenedChannelIds: "listened_channel_ids",
  debounceMs: "debounce_ms",
  statusLines: "status_lines",
  statusAt: "status_at",
  reflectionHours: "reflection_hours",
  botVersion: "bot_version",
  channelDirectory: "channel_directory",
  tidyDryRun: "tidy_dry_run",
  avatarFace: "avatar_face",
} as const satisfies Record<keyof BotSettings, string>;

export const DEFAULT_SETTINGS: BotSettings = {
  paused: false,
  spontaneity: 1,
  showFallbackTag: true,
  listenedChannelIds: [],
  debounceMs: 8_000,
  statusLines: [],
  statusAt: null,
  reflectionHours: DEFAULT_REFLECTION_HOURS,
  botVersion: null,
  channelDirectory: [],
  tidyDryRun: true,
  avatarFace: null,
};

/** Reads all settings, writing `seed` values for any key that was never set. */
export async function loadSettings(db: Database, seed: Partial<BotSettings> = {}): Promise<BotSettings> {
  const initial = { ...DEFAULT_SETTINGS, ...seed };
  await db
    .insert(settings)
    .values(
      Object.entries(KEYS)
        // A null default (bot_version, status_at) means "not known yet": nothing to store.
        .filter(([field]) => initial[field as keyof BotSettings] !== null)
        .map(([field, key]) => ({ key, value: initial[field as keyof BotSettings] })),
    )
    .onConflictDoNothing();

  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...initial };
  for (const [field, key] of Object.entries(KEYS) as [keyof BotSettings, string][]) {
    if (byKey.has(key)) Object.assign(result, { [field]: byKey.get(key) });
  }
  return result;
}

export async function saveSetting<K extends keyof BotSettings>(
  db: Database,
  field: K,
  value: BotSettings[K],
  updatedBy: string | null,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEYS[field], value, updatedBy })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy, updatedAt: sql`now()` } });
}

/** Settings without writing anything: for the site, whose database user can't. */
export async function readSettings(db: Database): Promise<BotSettings> {
  const rows = await db.select().from(settings);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...DEFAULT_SETTINGS };
  for (const [field, key] of Object.entries(KEYS) as [keyof BotSettings, string][]) {
    if (byKey.has(key)) Object.assign(result, { [field]: byKey.get(key) });
  }
  return result;
}
