import { describe, expect, it } from "vitest";
import { AmbientBudget, spontaneity } from "./spontaneity.ts";

describe("spontaneity", () => {
  it("maps levels and falls back to discreet", () => {
    expect(spontaneity(0).name).toBe("observateur");
    expect(spontaneity(3)).toMatchObject({ threshold: 4, perHour: 12 });
    expect(spontaneity(42).name).toBe("discret");
  });
});

describe("AmbientBudget", () => {
  function setup() {
    let now = 0;
    return { budget: new AmbientBudget(() => now), advance: (ms: number) => (now += ms) };
  }

  it("never allows anything in observer mode", () => {
    expect(setup().budget.allows("c", 0, 10)).toBe(false);
  });

  it("applies the interest threshold of the level", () => {
    const { budget } = setup();
    expect(budget.allows("c", 1, 7)).toBe(false);
    expect(budget.allows("c", 1, 8)).toBe(true);
    expect(budget.allows("c", 3, 4)).toBe(true);
  });

  it("caps interventions per channel per hour", () => {
    const { budget, advance } = setup();
    budget.record("c");
    budget.record("c");
    expect(budget.allows("c", 1, 10)).toBe(false);
    expect(budget.allows("other", 1, 10)).toBe(true);
    advance(60 * 60_000 + 1);
    expect(budget.allows("c", 1, 10)).toBe(true);
  });
});
