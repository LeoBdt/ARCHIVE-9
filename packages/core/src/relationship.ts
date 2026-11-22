import { AFFINITY_RANGE, TRUST_RANGE } from "./domain.ts";

export const RELATIONSHIP_CAPS = { perInteraction: 5, perDay: 15 };

export type RelationshipCaps = typeof RELATIONSHIP_CAPS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Limits a relationship change to the per-interaction cap and to what is left of the
 * daily budget, so a single conversation can't flip how ARCHIVE-9 feels about someone.
 */
export function capDelta(delta: number, dailySoFar: number, caps: RelationshipCaps = RELATIONSHIP_CAPS): number {
  if (!Number.isFinite(delta)) return 0;
  const step = clamp(Math.round(delta), -caps.perInteraction, caps.perInteraction);
  if (step > 0) return Math.min(step, Math.max(0, caps.perDay - dailySoFar));
  if (step < 0) return Math.max(step, Math.min(0, -caps.perDay - dailySoFar));
  return 0;
}

export function applyAffinity(value: number, delta: number): number {
  return clamp(value + delta, AFFINITY_RANGE.min, AFFINITY_RANGE.max);
}

export function applyTrust(value: number, delta: number): number {
  return clamp(value + delta, TRUST_RANGE.min, TRUST_RANGE.max);
}
