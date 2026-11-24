import { describe, expect, it } from "vitest";
import { diffStates, reliability, signed, stamp } from "./archive.ts";

describe("archive helpers", () => {
  it("stamps each nature, with dark inks", () => {
    expect(stamp("reported", "Léa")).toMatchObject({ text: "SELON LÉA", dashed: false });
    expect(stamp("inference", null)).toMatchObject({ text: "DÉDUIT ?", dashed: true });
    expect(stamp("probable_joke", null).ink).toBe("#7a5400");
  });

  it("turns confidence into five marks", () => {
    expect([0, 0.3, 0.9, 1].map(reliability)).toEqual([0, 2, 5, 5]);
  });

  it("signs numbers with a real minus", () => {
    expect([3, 0, -2].map(signed)).toEqual(["+3", "0", "−2"]);
  });

  it("tells what changed between two versions of itself", () => {
    const before = { mood: "m", opinions: ["a", "b"], runningJokes: [], notes: "", resolutions: [] };
    const after = { mood: "m", opinions: ["b", "c"], runningJokes: ["j"], notes: "", resolutions: ["piquer moins"] };
    expect(diffStates(before, after).map((c) => c.text)).toEqual(["◆ piquer moins", "+ c", "− a", "+ j"]);
  });
});
