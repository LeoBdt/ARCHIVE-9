import { describe, expect, it } from "vitest";
import { cleanOutgoing } from "./outgoing.ts";

describe("cleanOutgoing", () => {
  it.each([
    ["va sur archives.exemple.fr pour voir", "va sur https://archives.exemple.fr pour voir"],
    ["mon site : archives.exemple.fr/archives/123.", "mon site : https://archives.exemple.fr/archives/123."],
    ["déjà https://archives.exemple.fr ok", "déjà https://archives.exemple.fr ok"],
    ["github.com/LeoBdt, et voilà", "https://github.com/LeoBdt, et voilà"],
    ["écris à moi@exemple.fr", "écris à moi@exemple.fr"],
    ["ouvre index.ts et node.js", "ouvre index.ts et node.js"],
    ["<https://exemple.com>", "<https://exemple.com>"],
  ])("links: %s", (input, output) => {
    expect(cleanOutgoing(input)).toBe(output);
  });

  it("turns HTML into Discord markdown", () => {
    expect(cleanOutgoing("c'est <em>vraiment</em> <strong>grave</strong><br>non ?")).toBe("c'est *vraiment* **grave**\nnon ?");
    expect(cleanOutgoing('<a href="https://x.fr">ici</a> &amp; là')).toBe("ici (https://x.fr) & là");
  });

  it("leaves Discord tags and code alone", () => {
    expect(cleanOutgoing("<@123> regarde <#456> <t:1700000000:R> <:pizza:789>")).toBe("<@123> regarde <#456> <t:1700000000:R> <:pizza:789>");
    expect(cleanOutgoing("`archives.exemple.fr` et ```\n<em>x</em>\n```")).toBe("`archives.exemple.fr` et ```\n<em>x</em>\n```");
  });
});
