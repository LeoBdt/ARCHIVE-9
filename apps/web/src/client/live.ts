import type { QueryClient } from "@tanstack/react-query";

/** Which pages to refresh for each kind of change. */
export const REFRESH: Record<string, string[]> = {
  decisions: ["journal", "home"],
  actions_log: ["journal", "home"],
  profile_facts: ["home", "dossier", "dossiers", "journal", "search", "technique"],
  fact_operations: ["technique", "dossier"],
  capability_gaps: ["technique"],
  learned: ["home", "dossier", "dossiers", "journal", "relations"],
  fact_categories: ["dossier", "journal"],
  relationship_events: ["relations", "dossier", "home", "journal"],
  self_state_versions: ["esprit", "home", "journal"],
  self_state: ["esprit", "home", "journal"],
  skills: ["skills", "home", "journal"],
  settings: ["home", "settings", "systeme", "esprit"],
  feedback: ["esprit", "technique"],
  site_requests: ["request"],
  releases: ["systeme"],
};

/**
 * Listens to the site's live stream and refreshes what changed, at most once a second per
 * page. EventSource reconnects by itself if the stream drops; polling stays as a fallback.
 */
export function startLive(client: QueryClient): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  const source = new EventSource("/api/live");
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  source.addEventListener("change", (event) => {
    for (const key of REFRESH[(event as MessageEvent<string>).data] ?? []) pending.add(key);
    timer ??= setTimeout(() => {
      for (const key of pending) void client.invalidateQueries({ queryKey: [key] });
      pending.clear();
      timer = undefined;
    }, 1_000);
  });
  return () => {
    source.close();
    clearTimeout(timer);
  };
}
