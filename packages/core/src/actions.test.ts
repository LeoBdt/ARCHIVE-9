import { describe, expect, it } from "vitest";
import { channelSlug, checkMemberTarget, checkRequester, checkRoleTarget } from "./actions.ts";

describe("checkRequester", () => {
  it("only acts when a member asked, on the server", () => {
    expect(checkRequester({ addressed: true, isBot: false, inGuild: true })).toBeNull();
    expect(checkRequester({ addressed: false, isBot: false, inGuild: true })).toContain("demande");
    expect(checkRequester({ addressed: true, isBot: true, inGuild: true })).toContain("bots");
    expect(checkRequester({ addressed: true, isBot: false, inGuild: false })).toContain("privé");
  });
});

describe("checkMemberTarget", () => {
  const ok = { isSelf: false, isOwner: false, isBot: false, optedOut: false, manageable: true, requesterAbove: true };
  it("allows a regular member", () => {
    expect(checkMemberTarget(ok)).toBeNull();
  });
  it.each(["isSelf", "isOwner", "isBot", "optedOut"] as const)("refuses when %s", (key) => {
    expect(checkMemberTarget({ ...ok, [key]: true })).not.toBeNull();
  });
  it("follows Discord's hierarchy for the requester", () => {
    expect(checkMemberTarget({ ...ok, requesterAbove: false })).toContain("pas au-dessus");
  });
  it("refuses a member above ARCHIVE-9", () => {
    expect(checkMemberTarget({ ...ok, manageable: false })).toContain("au-dessus");
  });
});

describe("checkRoleTarget", () => {
  const ok = { isEveryone: false, managed: false, hasSensitivePermission: false, belowMine: true, belowRequester: true };
  it("allows a plain role below ARCHIVE-9's", () => {
    expect(checkRoleTarget(ok)).toBeNull();
  });
  it("refuses sensitive, managed or higher roles", () => {
    expect(checkRoleTarget({ ...ok, hasSensitivePermission: true })).toContain("sensibles");
    expect(checkRoleTarget({ ...ok, managed: true })).not.toBeNull();
    expect(checkRoleTarget({ ...ok, belowMine: false })).toContain("au-dessus");
    expect(checkRoleTarget({ ...ok, belowRequester: false })).toContain("personne qui demande");
  });
});

describe("channelSlug", () => {
  it("turns a name into a Discord channel name", () => {
    expect(channelSlug("  Soirée Jeux  du Vendredi! ")).toBe("soirée-jeux-du-vendredi");
  });
});
