import { INITIAL_SELF_STATE, writeStatus } from "@archive-9/ai";
import { currentSelfState, recordAiUsage, type Database } from "@archive-9/db";
import { randomUUID } from "node:crypto";
import { ActivityType, type Client } from "discord.js";
import type { AiRuntime } from "@archive-9/ai";
import type { Logger } from "./logger.ts";
import type { SettingsStore } from "./settings.ts";

const MIN_MS = 4 * 60 * 60_000;
const MAX_MS = 6 * 60 * 60_000;
const KEPT = 5;
export const PAUSED_STATUS = "En veille. J'écoute quand même.";

export interface PresenceDeps {
  db: Database;
  ai: AiRuntime;
  log: Logger;
  settings: SettingsStore;
  timezone: string;
  version: string;
}

/** Between 4 and 6 hours, so the change doesn't look mechanical. */
export function nextDelay(random: () => number = Math.random): number {
  return MIN_MS + Math.floor(random() * (MAX_MS - MIN_MS));
}

/** ARCHIVE-9's profile status: a line written by the small model, renewed every 4 to 6 hours. */
export class Presence {
  private readonly deps: PresenceDeps;
  private client: Client<true> | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(deps: PresenceDeps) {
    this.deps = deps;
  }

  start(client: Client<true>): void {
    this.client = client;
    if (this.deps.settings.value.statusLines.length === 0) void this.renew();
    else this.show();
    this.schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  /** Shows the current line, or the pause line while paused. */
  show(): void {
    const line = this.deps.settings.value.paused ? PAUSED_STATUS : this.deps.settings.value.statusLines[0];
    if (!this.client || !line) return;
    this.client.user.setPresence({ status: "online", activities: [{ type: ActivityType.Custom, name: "custom", state: line }] });
  }

  async renew(): Promise<void> {
    const { db, ai, log, settings } = this.deps;
    try {
      const previous = settings.value.statusLines;
      const { status, usage } = await writeStatus(ai, {
        now: new Date(),
        timezone: this.deps.timezone,
        selfState: await currentSelfState(db, INITIAL_SELF_STATE),
        previous,
      });
      const runId = randomUUID();
      await recordAiUsage(db, usage.map((u) => ({ ...u, runId, detail: "statut", version: this.deps.version })));
      if (!status) return;
      await settings.set("statusLines", [status, ...previous.filter((p) => p !== status)].slice(0, KEPT), null);
      await settings.set("statusAt", new Date().toISOString(), null);
      log.info({ status }, "status renewed");
    } catch (error) {
      log.warn({ err: error }, "status renewal failed");
    }
    this.show();
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.renew().finally(() => {
        this.schedule();
      });
    }, nextDelay());
  }
}
