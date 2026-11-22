import { truncate } from "./content.ts";
import type { SelfState } from "./domain.ts";

export interface ListChange {
  add: string[];
  /** 1-based positions in the current list. */
  remove: number[];
}

/** What the daily reflection wants to change. */
export interface SelfStateChange {
  mood: string;
  opinions: ListChange;
  runningJokes: ListChange;
  notes: string;
}

export const SELF_STATE_LIMITS = {
  changesPerList: 2,
  maxItems: 10,
  maxItemLength: 160,
  maxMoodLength: 120,
  maxNotesLength: 600,
};

export type SelfStateLimits = typeof SELF_STATE_LIMITS;

function applyList(current: readonly string[], change: ListChange, limits: SelfStateLimits): string[] {
  const removed = new Set(
    [...new Set(change.remove)]
      .filter((position) => Number.isInteger(position) && position >= 1 && position <= current.length)
      .slice(0, limits.changesPerList),
  );
  const kept = current.filter((_, index) => !removed.has(index + 1));
  const known = new Set(kept.map((item) => item.toLowerCase()));
  const added: string[] = [];
  for (const raw of change.add) {
    const item = truncate(raw.trim(), limits.maxItemLength);
    if (!item || known.has(item.toLowerCase())) continue;
    known.add(item.toLowerCase());
    added.push(item);
    if (added.length === limits.changesPerList) break;
  }
  // Oldest entries go first when the list is full.
  return [...kept, ...added].slice(-limits.maxItems);
}

/** Applies a reflection, capping how much ARCHIVE-9 can change in a single day. */
export function applySelfStateChange(
  current: SelfState,
  change: SelfStateChange,
  limits: SelfStateLimits = SELF_STATE_LIMITS,
): SelfState {
  const mood = truncate(change.mood.trim(), limits.maxMoodLength);
  const notes = truncate(change.notes.trim(), limits.maxNotesLength);
  return {
    mood: mood || current.mood,
    opinions: applyList(current.opinions, change.opinions, limits),
    runningJokes: applyList(current.runningJokes, change.runningJokes, limits),
    notes: notes || current.notes,
  };
}
