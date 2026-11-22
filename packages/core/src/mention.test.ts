import { describe, expect, it } from "vitest";
import { createNameMatcher, stripCode } from "./mention.ts";

describe("createNameMatcher", () => {
  const matches = createNameMatcher(["ARCHIVE-9", "archive", " A9 "]);

  it("matches names as whole words, any case", () => {
    expect(matches("salut archive-9 ça va")).toBe(true);
    expect(matches("ARCHIVE tu dors ?")).toBe(true);
    expect(matches("a9 réponds")).toBe(true);
  });

  it("ignores names inside other words", () => {
    expect(matches("j'archive mes photos")).toBe(true);
    expect(matches("archives du serveur")).toBe(false);
    expect(matches("ma9ique")).toBe(false);
  });

  it("ignores names inside code", () => {
    expect(matches("regarde `archive` là")).toBe(false);
    expect(matches("```\nconst archive = 1\n```")).toBe(false);
  });

  it("never matches with an empty name list", () => {
    expect(createNameMatcher(["", "  "])("archive")).toBe(false);
  });
});

describe("stripCode", () => {
  it("removes inline and fenced code", () => {
    expect(stripCode("a `b` c ```d``` e")).toBe("a   c   e");
  });
});
