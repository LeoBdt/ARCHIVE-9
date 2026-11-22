import type { ButtonInteraction, GuildBasedChannel } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context.ts";

const db = vi.hoisted(() => ({
  countActions: vi.fn(() => Promise.resolve(0)),
  logAction: vi.fn(() => Promise.resolve("a1")),
  optedOutIds: vi.fn(() => Promise.resolve(new Set<string>())),
  getAction: vi.fn(),
  claimPending: vi.fn(() => Promise.resolve({ id: "a1" })),
  finishAction: vi.fn(() => Promise.resolve()),
}));
vi.mock("@archive-9/db", () => db);

const { createActionTools } = await import("./actions.ts");
const { handleConfirmation } = await import("./confirm.ts");
const { findChannel } = await import("./free.ts");
const { describeAction, formatSkills } = await import("../commands.ts");

const opts = { toolCallId: "t", messages: [], context: {} };
const AGENTS = "500";

interface FakeOptions {
  rank?: number;
  bot?: boolean;
  manageable?: boolean;
  nickname?: string | null;
  perms?: bigint[];
}

function fakeMember(id: string, o: FakeOptions = {}) {
  const rank = o.rank ?? 1;
  return {
    id,
    displayName: `user${id}`,
    nickname: o.nickname ?? null,
    manageable: o.manageable ?? true,
    user: { bot: o.bot ?? false, username: `user${id}` },
    permissions: { has: (flag: bigint) => (o.perms ?? []).includes(flag) },
    roles: { highest: { position: rank, comparePositionTo: (other: { position: number }) => rank - other.position } },
    guild: { ownerId: "owner" },
    setNickname: vi.fn(() => Promise.resolve()),
  };
}

function fakeChannel(id: string, parentId: string | null) {
  return {
    id,
    name: `salon-${id}`,
    type: ChannelType.GuildText,
    parentId,
    isDMBased: () => false,
    isThread: () => false,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => false }),
    setName: vi.fn(() => Promise.resolve()),
  };
}

function setup(o: { addressed?: boolean; authorBot?: boolean; requester?: ReturnType<typeof fakeMember>; members?: ReturnType<typeof fakeMember>[]; channel?: ReturnType<typeof fakeChannel> } = {}) {
  const requester = o.requester ?? fakeMember("req", { rank: 5, perms: [PermissionFlagsBits.ManageNicknames] });
  const members = new Map([requester, ...(o.members ?? [])].map((m) => [m.id, m]));
  const channel = o.channel ?? fakeChannel("c1", null);
  const guild = {
    id: "g",
    ownerId: "owner",
    members: { fetch: (id: string) => Promise.resolve(members.get(id) ?? null), me: { roles: { highest: { position: 10 } } } },
    channels: { cache: new Map([[channel.id, channel]]) },
  };
  const reply = vi.fn(() => Promise.resolve({ id: "confirm-msg" }));
  const ctx = {
    db: {},
    log: { info: vi.fn(), warn: vi.fn() },
    selfId: "self",
    guildId: "g",
    agentsCategoryId: AGENTS,
    addressed: o.addressed ?? true,
    send: { sentMessageIds: [] as string[] },
    target: {
      id: "m1",
      guildId: "g",
      channelId: channel.id,
      channel,
      member: requester,
      reply,
      author: { id: requester.id, bot: o.authorBot ?? false, username: "req" },
      client: { guilds: { cache: new Map([["g", guild]]) } },
    },
  } as unknown as ToolContext;
  return { ctx, tools: createActionTools(ctx), reply, guild, channel };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("controlled actions", () => {
  it("asks for a confirmation before touching the rest of the server", async () => {
    const tom = fakeMember("1", { nickname: "Tom" });
    const { tools, reply, ctx } = setup({ members: [tom] });
    const result = await tools.renameMember.execute({ memberId: "1", nickname: "Tomate" }, opts);
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(tom.setNickname).not.toHaveBeenCalled();
    expect(db.logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tool: "renameMember", status: "pending" }));
    expect(JSON.stringify(reply.mock.calls)).toContain("confirm:a1");
    expect(ctx.send.sentMessageIds).toEqual(["confirm-msg"]);
  });

  it("acts right away inside AGENTS", async () => {
    const channel = fakeChannel("c1", AGENTS);
    const { tools, reply } = setup({ channel, requester: fakeMember("req") });
    const result = await tools.renameChannel.execute({ name: "Labo Des Bots" }, opts);
    expect(result).toMatchObject({ ok: true, after: "labo-des-bots" });
    expect(channel.setName).toHaveBeenCalledWith("labo-des-bots", expect.any(String));
    expect(reply).not.toHaveBeenCalled();
    expect(db.logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "done", previousValue: { channelId: "c1", name: "salon-c1" } }));
  });

  it("needs the requester's own Discord permission outside AGENTS", async () => {
    const { tools, channel } = setup({ requester: fakeMember("req", { rank: 5 }) });
    expect(JSON.stringify(await tools.renameChannel.execute({ name: "x" }, opts))).toContain("Gérer les salons");
    expect(channel.setName).not.toHaveBeenCalled();
  });

  it("follows the role hierarchy", async () => {
    const { tools } = setup({ members: [fakeMember("1", { rank: 7 })] });
    expect(JSON.stringify(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts))).toContain("pas au-dessus");
  });

  it("never acts on its own initiative, nor for a bot", async () => {
    for (const options of [{ addressed: false }, { authorBot: true }]) {
      const tom = fakeMember("1");
      const { tools } = setup({ ...options, members: [tom] });
      expect(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts)).toMatchObject({ ok: false });
    }
    expect(db.logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "refused" }));
  });

  it("never touches the owner, bots or members who left the archives", async () => {
    db.optedOutIds.mockResolvedValue(new Set(["3"]));
    const { tools } = setup({ members: [fakeMember("owner"), fakeMember("2", { bot: true }), fakeMember("3")] });
    for (const memberId of ["owner", "2", "3"]) {
      expect(await tools.renameMember.execute({ memberId, nickname: "x" }, opts)).toMatchObject({ ok: false });
    }
    db.optedOutIds.mockResolvedValue(new Set());
  });

  it("stops after 5 actions of a type in the hour", async () => {
    db.countActions.mockResolvedValueOnce(5);
    const { tools, reply } = setup({ members: [fakeMember("1")] });
    expect(JSON.stringify(await tools.renameMember.execute({ memberId: "1", nickname: "x" }, opts))).toContain("5 actions");
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("confirmation buttons", () => {
  function click(userId: string, action: Record<string, unknown> | undefined, guild: unknown) {
    db.getAction.mockResolvedValueOnce(action);
    const update = vi.fn(() => Promise.resolve());
    const reply = vi.fn(() => Promise.resolve());
    const i = { user: { id: userId, username: "req" }, guild, message: { content: "**Confirmation** · x ?\n-# ..." }, memberPermissions: { has: () => false }, update, reply };
    return { i: i as unknown as ButtonInteraction, update, reply };
  }
  const deps = { db: {} as never, log: { info: vi.fn() } as never, selfId: "self", agentsCategoryId: AGENTS };
  const pending = (over: Record<string, unknown> = {}) => ({
    id: "a1",
    tool: "renameMember",
    status: "pending",
    requestedBy: "req",
    params: { memberId: "1", nickname: "Tomate" },
    createdAt: new Date(),
    ...over,
  });

  it("runs the action when the requester confirms", async () => {
    const tom = fakeMember("1", { nickname: "Tom" });
    const { guild } = setup({ members: [tom] });
    const { i, update } = click("req", pending(), guild);
    await handleConfirmation(i, deps, true, "a1");
    expect(tom.setNickname).toHaveBeenCalledWith("Tomate", expect.any(String));
    expect(db.finishAction).toHaveBeenCalledWith(expect.anything(), "a1", { status: "done", previousValue: { memberId: "1", nickname: "Tom" } });
    expect(JSON.stringify(update.mock.calls)).toContain("Fait");
  });

  it("only listens to the requester", async () => {
    const { guild } = setup({ members: [fakeMember("1")] });
    const { i, reply } = click("someone", pending(), guild);
    await handleConfirmation(i, deps, true, "a1");
    expect(db.claimPending).not.toHaveBeenCalled();
    expect(JSON.stringify(reply.mock.calls)).toContain("Seule la personne");
  });

  it("expires after 10 minutes", async () => {
    const tom = fakeMember("1");
    const { guild } = setup({ members: [tom] });
    const { i } = click("req", pending({ createdAt: new Date(Date.now() - 11 * 60_000) }), guild);
    await handleConfirmation(i, deps, true, "a1");
    expect(db.claimPending).toHaveBeenCalledWith(expect.anything(), "a1", "cancelled", "expirée");
    expect(tom.setNickname).not.toHaveBeenCalled();
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
      { id: "s", name: "Pizza", kind: "triggered", triggers: ["pizza", "ananas"], rule: "L'ananas est un crime.", authorId: "1", authorName: "tom", usageCount: 3, expiresAt: null, createdAt: new Date() },
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
