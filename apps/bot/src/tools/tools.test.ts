import type { GuildBasedChannel } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context.ts";

const db = vi.hoisted(() => ({
  countActions: vi.fn(() => Promise.resolve(0)),
  logAction: vi.fn(() => Promise.resolve("a1")),
  optedOutIds: vi.fn(() => Promise.resolve(new Set<string>())),
}));
vi.mock("@archive-9/db", () => db);

const { createActionTools } = await import("./actions.ts");
const { findChannel } = await import("./free.ts");
const { describeAction, formatSkills } = await import("../commands.ts");

const opts = { toolCallId: "t", messages: [], context: {} };

function fakeMember(id: string, extra: { admin?: boolean; bot?: boolean; manageable?: boolean; nickname?: string | null } = {}) {
  return {
    id,
    nickname: extra.nickname ?? null,
    manageable: extra.manageable ?? true,
    user: { bot: extra.bot ?? false, username: `user${id}` },
    permissions: { has: (flag: bigint) => Boolean(extra.admin) && flag === PermissionFlagsBits.Administrator },
    guild: { ownerId: "owner" },
    setNickname: vi.fn(() => Promise.resolve()),
  };
}

function setup(options: { addressed?: boolean; authorBot?: boolean; members?: ReturnType<typeof fakeMember>[] } = {}) {
  const members = new Map((options.members ?? []).map((m) => [m.id, m]));
  const guild = { id: "g", ownerId: "owner", members: { fetch: (id: string) => Promise.resolve(members.get(id) ?? null) } };
  const ctx = {
    db: {},
    log: { info: vi.fn(), warn: vi.fn() },
    selfId: "self",
    guildId: "g",
    addressed: options.addressed ?? true,
    target: {
      id: "m1",
      guildId: "g",
      author: { id: "req", bot: options.authorBot ?? false, username: "req" },
      client: { guilds: { cache: new Map([["g", guild]]) } },
    },
  } as unknown as ToolContext;
  return { ctx, tools: createActionTools(ctx) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("controlled actions", () => {
  it("renames a member and keeps the old nickname for undo", async () => {
    const tom = fakeMember("1", { nickname: "Tom" });
    const { tools } = setup({ members: [tom] });
    const result = await tools.renameMember.execute({ memberId: "1", nickname: "Tomate" }, opts);
    expect(result).toMatchObject({ ok: true, before: "Tom", after: "Tomate" });
    expect(tom.setNickname).toHaveBeenCalledWith("Tomate", expect.any(String));
    expect(db.logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tool: "renameMember", status: "done", previousValue: { memberId: "1", nickname: "Tom" } }));
  });

  it("never acts on its own initiative", async () => {
    const tom = fakeMember("1");
    const { tools } = setup({ addressed: false, members: [tom] });
    expect(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts)).toMatchObject({ ok: false });
    expect(tom.setNickname).not.toHaveBeenCalled();
    expect(db.logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "refused" }));
  });

  it("refuses requests from bots", async () => {
    const { tools } = setup({ authorBot: true, members: [fakeMember("1")] });
    expect(JSON.stringify(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts))).toContain("bots");
  });

  it("never touches admins, the owner or bots", async () => {
    const { tools } = setup({ members: [fakeMember("1", { admin: true }), fakeMember("owner"), fakeMember("2", { bot: true })] });
    for (const memberId of ["1", "owner", "2"]) {
      expect(await tools.renameMember.execute({ memberId, nickname: "x" }, opts)).toMatchObject({ ok: false });
    }
  });

  it("refuses members who left the archives", async () => {
    db.optedOutIds.mockResolvedValueOnce(new Set(["1"]));
    const { tools } = setup({ members: [fakeMember("1")] });
    expect(JSON.stringify(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts))).toContain("hors archives");
  });

  it("stops after 5 actions of a type in the hour", async () => {
    db.countActions.mockResolvedValueOnce(5);
    const tom = fakeMember("1");
    const { tools } = setup({ members: [tom] });
    expect(JSON.stringify(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts))).toContain("5 actions");
    expect(tom.setNickname).not.toHaveBeenCalled();
  });

  it("logs a Discord failure", async () => {
    const tom = fakeMember("1");
    tom.setNickname.mockRejectedValueOnce(new Error("Missing Permissions"));
    const { tools } = setup({ members: [tom] });
    expect(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts)).toEqual({ ok: false, error: "Missing Permissions" });
    expect(db.logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "failed", refusalReason: "Missing Permissions" }));
  });
});

describe("findChannel", () => {
  const channels = [{ id: "111111111111111111", name: "général" }, { id: "222222222222222222", name: "Jeux" }] as GuildBasedChannel[];
  it("finds a channel by tag, ID or name", () => {
    expect(findChannel(channels, "<#222222222222222222>")?.name).toBe("Jeux");
    expect(findChannel(channels, "111111111111111111")?.name).toBe("général");
    expect(findChannel(channels, "#jeux")?.id).toBe("222222222222222222");
    expect(findChannel(channels, "musique")).toBeNull();
  });
});

describe("commands", () => {
  it("lists skills with their author and use count", () => {
    const text = formatSkills([
      { id: "s", name: "Pizza", kind: "triggered", triggers: ["pizza", "ananas"], rule: "L'ananas est un crime.", authorId: "1", authorName: "tom", usageCount: 3, createdAt: new Date() },
    ]);
    expect(text).toContain("**Skills** · 1/200");
    expect(text).toContain("- **Pizza** · si « pizza, ananas » · par <@1> · 3 fois\n  L'ananas est un crime.");
    expect(formatSkills([])).toContain("Aucune skill");
  });

  it("describes logged actions", () => {
    expect(describeAction({ tool: "renameChannel", params: { name: "jeux" }, previousValue: { name: "general" } })).toBe("salon renommé : #general → jeux");
    expect(describeAction({ tool: "setRole", params: { role: "Gamer", give: false, memberId: "1" }, previousValue: null })).toBe("rôle Gamer retiré à <@1>");
  });
});
