import { describe, expect, it } from "vitest";
import { docSections, findSections } from "./memory.ts";

describe("its own documentation", () => {
  const doc = "# Architecture\n\n## Learning\n\nThe analysis reads conversations.\n\n### Reflection\n\nTwice a day.\n\n```mermaid\nflowchart\n```\n\n## Site\n\nPages.";

  it("cuts the doc by heading and drops diagrams", () => {
    const sections = docSections(doc);
    expect(sections.map((s) => s.title)).toEqual(["Learning", "Reflection", "Site"]);
    expect(sections[1]?.body).toBe("Twice a day.");
  });

  it("finds the sections about a topic", () => {
    expect(findSections(docSections(doc), "reflection").map((s) => s.title)).toEqual(["Reflection"]);
    expect(findSections(docSections(doc), "?")).toEqual([]);
  });
});
