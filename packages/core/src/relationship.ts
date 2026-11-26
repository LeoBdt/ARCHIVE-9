import { AFFINITY_RANGE, TRUST_RANGE } from "./domain.ts";

/** A change is one of these steps; the two axes move by ±1 at most per day. */
export const RELATIONSHIP_CAPS = { steps: [0.1, 0.2, 0.3, 0.4, 0.5], perDay: 1 };

export type RelationshipCaps = typeof RELATIONSHIP_CAPS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** One decimal, without float noise. */
export function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Turns the model's change into an allowed step (0.1 to 0.5) and what is left of the
 * daily budget, so a single day can't flip how ARCHIVE-9 feels about someone.
 */
export function capDelta(delta: number, dailySoFar: number, caps: RelationshipCaps = RELATIONSHIP_CAPS): number {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return 0;
  const largest = caps.steps.at(-1) ?? 0.5;
  const step = Math.sign(delta) * Math.min(largest, Math.max(caps.steps[0] ?? 0.1, tenth(Math.abs(delta))));
  if (step > 0) return tenth(Math.min(step, Math.max(0, caps.perDay - dailySoFar)));
  return tenth(Math.max(step, Math.min(0, -caps.perDay - dailySoFar)));
}

export function applyAffinity(value: number, delta: number): number {
  return tenth(clamp(value + delta, AFFINITY_RANGE.min, AFFINITY_RANGE.max));
}

export function applyTrust(value: number, delta: number): number {
  return tenth(clamp(value + delta, TRUST_RANGE.min, TRUST_RANGE.max));
}
