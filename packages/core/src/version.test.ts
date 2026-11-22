import { describe, expect, it } from "vitest";
import { versionLabel, versionName } from "./version.ts";

describe("versionName", () => {
  it("turns a commit into an invented word, always the same", () => {
    expect(versionName("32a135e9ea3ca398f3604f82f2b97b4618df36a8")).toBe("Syris");
    expect(versionName("0664368cb8c0c3b2d36ecbc90d50a908066dc359")).toBe("Thalilis");
    expect(versionName("32a135e9ea3ca398f3604f82f2b97b4618df36a8")).toBe(versionName("32A135E9EA3CA398F3604F82F2B97B4618DF36A8"));
  });

  it("builds Novahe from its three syllables", () => {
    // No (0x00) · va (0x00) · he (0x00), even last byte: three syllables
    expect(versionName("00000000")).toBe("Novahe");
    expect(versionName("00000001")).toBe("Nohe");
  });

  it("refuses anything that isn't a commit", () => {
    expect(versionName("dev")).toBeNull();
  });
});

describe("versionLabel", () => {
  it("shows the name and the short commit", () => {
    expect(versionLabel("32a135e9ea3ca398f3604f82f2b97b4618df36a8")).toBe("Syris (32a135e)");
    expect(versionLabel(undefined)).toBe("dev");
    expect(versionLabel("dev")).toBe("dev");
  });
});
