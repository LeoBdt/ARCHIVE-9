import type { SqlClient } from "@archive-9/db";

/** The tables whose changes the site shows; anything else on the channel is ignored. */
export const LIVE_TYPES = new Set(["decisions", "actions_log", "profile_facts", "relationship_events", "self_state_versions", "skills", "settings", "feedback", "self_state"]);

export interface Live {
  subscribe: (listener: (type: string) => void) => () => void;
}

/** One LISTEN connection for the whole site, shared by every open page. */
export async function startLive(sql: SqlClient, onError: (err: unknown) => void): Promise<Live> {
  const listeners = new Set<(type: string) => void>();
  await sql.listen("archive9", (payload) => {
    try {
      const { type } = JSON.parse(payload) as { type?: unknown };
      if (typeof type === "string" && LIVE_TYPES.has(type)) for (const listener of listeners) listener(type);
    } catch (err) {
      onError(err);
    }
  });
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
