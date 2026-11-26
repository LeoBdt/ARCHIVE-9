import { describe, expect, it } from "vitest";
import { fragmentCode, newFragmentRef, parseFragmentNumber, parseFragmentRef } from "./fragments.ts";
import { isEmptySearch, parseSearchQuery } from "./search.ts";

describe("fragment references", () => {
  it("draws six unambiguous characters", () => {
    const ref = newFragmentRef();
    expect(ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(newFragmentRef(() => new Uint8Array([0, 31, 32, 10, 18, 255]))).toBe("0Z0AJZ");
  });

  it("reads what people type", () => {
    expect(parseFragmentRef("#k7qx3m")).toBe("K7QX3M");
    expect(parseFragmentRef("k7-qx 3m")).toBe("K7QX3M");
    expect(parseFragmentRef("#0OIL11")).toBe("001111");
    expect(parseFragmentRef("#K7QX")).toBeNull();
    expect(parseFragmentRef("#K7QXUM")).toBeNull();
  });

  it("writes and reads ranks", () => {
    expect(fragmentCode(12)).toBe("F012");
    expect(parseFragmentNumber("f12")).toBe(12);
    expect(parseFragmentNumber("F0012")).toBe(12);
    expect(parseFragmentNumber("Fx")).toBeNull();
  });
});

describe("the search bar", () => {
  const now = new Date("2026-11-26T12:00:00Z");

  it("splits words, people, references, filters and phrases", () => {
    const q = parseSearchQuery('@léa pizza "pâtes maison" #k7qx3m F012 tiroir:jeux nature:blague type:messages après:20/11 avant:2026-11-25', now);
    expect(q).toMatchObject({ text: "pizza", phrases: ["pâtes maison"], people: ["léa"], refs: ["K7QX3M"], numbers: [12], drawer: "jeux", nature: "probable_joke", kind: "messages" });
    expect(q.after?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(q.before?.toISOString()).toBe("2026-11-25T00:00:00.000Z");
  });

  it("knows when there is nothing to look for", () => {
    expect(isEmptySearch(parseSearchQuery("   "))).toBe(true);
    expect(isEmptySearch(parseSearchQuery("type:skills"))).toBe(true);
    expect(isEmptySearch(parseSearchQuery("@tom"))).toBe(false);
  });
});
