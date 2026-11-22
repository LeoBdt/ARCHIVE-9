import { loadSettings, readSettings, saveSetting, type BotSettings, type Database } from "@archive-9/db";

/** In-memory copy of the settings, written through to the database. */
export class SettingsStore {
  private readonly db: Database;
  private current: BotSettings;

  private constructor(db: Database, initial: BotSettings) {
    this.db = db;
    this.current = initial;
  }

  static async load(db: Database, seed: Partial<BotSettings>): Promise<SettingsStore> {
    return new SettingsStore(db, await loadSettings(db, seed));
  }

  get value(): Readonly<BotSettings> {
    return this.current;
  }

  isListened(channelId: string, parentId: string | null): boolean {
    const ids = this.current.listenedChannelIds;
    return ids.includes(channelId) || (parentId !== null && ids.includes(parentId));
  }

  /** Picks up changes made elsewhere (the site). */
  async reload(): Promise<void> {
    this.current = await readSettings(this.db);
  }

  async set<K extends keyof BotSettings>(field: K, value: BotSettings[K], by: string | null): Promise<void> {
    await saveSetting(this.db, field, value, by);
    this.current = { ...this.current, [field]: value };
  }
}
