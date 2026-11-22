import { describe, expect, it } from "vitest";
import { createMemberFinder, normaliseName, resolveMentions } from "./directory.ts";
import { formatTranscript } from "./transcript.ts";

const find = createMemberFinder([
  { id: "1", names: ["Jean Pascal"] },
  { id: "2", names: ["Dave Ops", "leo.bidot"] },
  { id: "3", names: ["Léa"] },
  { id: "4", names: ["10cordes"] },
  { id: "5", names: ["Le Bon Max"] },
]);

describe("createMemberFinder", () => {
  it("finds people by initials, first name, full or former name", () => {
    expect(find("parle moi de jp")).toEqual(["1"]);
    expect(find("t'en penses quoi de Jean ?")).toEqual(["1"]);
    expect(find("et LEO BIDOT alors")).toEqual(["2"]);
    expect(find("leo il est où")).toEqual(["2"]);
    expect(find("lea et 10cordes")).toEqual(["4", "3"]);
  });

  it("ignores everyday words, code and partial words", () => {
    expect(find("le bon moment")).toEqual([]);
    expect(find("`jp` dans le code")).toEqual([]);
    expect(find("jpeg et leaf")).toEqual([]);
    expect(find("")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(find("jp leo lea 10cordes", 2)).toHaveLength(2);
  });

  it("normalises accents and punctuation", () => {
    expect(normaliseName("  Léa_du-Sud! ")).toBe("lea du sud");
  });
});

describe("resolveMentions", () => {
  const names = new Map([["123456789012345678", "Jean Pascal"]]);

  it("turns known tags into names and leaves the others", () => {
    expect(resolveMentions("salut <@123456789012345678> et <@!987654321098765432>", names)).toBe(
      "salut @Jean Pascal et <@!987654321098765432>",
    );
  });

  it("is applied by formatTranscript", () => {
    const line = formatTranscript(
      [{ id: "1", authorId: "2", authorName: "Tom", authorIsBot: false, isSelf: false, content: "<@123456789012345678> ?", replyToId: null, createdAt: new Date("2026-01-01T10:00:00Z") }],
      { names },
    );
    expect(line).toBe("10:00 #1 [Tom (ID 2)] : @Jean Pascal ?");
  });
});
