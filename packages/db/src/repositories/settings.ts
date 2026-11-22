import { sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { settings } from "../schema.ts";

export interface BotSettings {
  paused: boolean;
  /** 0 observer, 1 discreet, 2 normal, 3 chatty. */
  spontaneity: number;
  showFallbackTag: boolean;
  listenedChannelIds: string[];
  /** Written by an admin: what the server is. Given to every prompt. */
  serverDescription: string;
  debounceMs: number;
}

const KEYS = {
  paused: "paused",
  spontaneity: "spontaneity",
  showFallbackTag: "show_fallback_tag",
  listenedChannelIds: "listened_channel_ids",
  serverDescription: "server_description",
  debounceMs: "debounce_ms",
} as const satisfies Record<keyof BotSettings, string>;

export const DEFAULT_SETTINGS: BotSettings = {
  paused: false,
  spontaneity: 1,
  showFallbackTag: true,
  listenedChannelIds: [],
  serverDescription: "",
  debounceMs: 8_000,
};

/** Reads all settings, writing `seed` values for any key that was never set. */
export async function loadSettings(db: Database, seed: Partial<BotSettings> = {}): Promise<BotSettings> {
  const initial = { ...DEFAULT_SETTINGS, ...seed };
  await db
    .insert(settings)
    .values(Object.entries(KEYS).map(([field, key]) => ({ key, value: initial[field as keyof BotSettings] })))
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
