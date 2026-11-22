import { describe, expect, it } from "vitest";
import { discordIdFromEmail } from "./auth.ts";

describe("discordIdFromEmail", () => {
  it("reads the ID back from the placeholder email", () => {
    expect(discordIdFromEmail("312845519027012345@discord.invalid")).toBe("312845519027012345");
  });

  it("ignores anything else", () => {
    expect(discordIdFromEmail("tom@example.org")).toBeNull();
    expect(discordIdFromEmail("312845519027012345@discordXinvalid")).toBeNull();
    expect(discordIdFromEmail("abc@discord.invalid")).toBeNull();
  });
});
