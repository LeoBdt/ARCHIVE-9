import type { Message, SendableChannels } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createSendTools, type SendState } from "./send-tools.ts";

function fakes() {
  let n = 0;
  const reply = vi.fn((options: { content: string }) => Promise.resolve({ id: `r${String(++n)}`, content: options.content }));
  const send = vi.fn((options: { content: string }) => Promise.resolve({ id: `s${String(++n)}`, content: options.content }));
  const react = vi.fn(() => Promise.resolve());
  const target = { reply, react } as unknown as Message;
  const channel = { send } as unknown as SendableChannels;
  return { target, channel, reply, send, react };
}

const opts = { toolCallId: "t", messages: [], context: {} };

describe("send tools", () => {
  it("replies to the target and records the message", async () => {
    const f = fakes();
    const state: SendState = { sentMessageIds: [], reacted: false, silenced: false };
    const tools = createSendTools(f.channel, f.target, state);
    await tools.sendReply.execute({ content: "  salut  " }, opts);
    expect(f.reply).toHaveBeenCalledWith({ content: "salut" });
    expect(state.sentMessageIds).toEqual(["r1"]);
  });

  it("adds the fallback tag to the first message only", async () => {
    const f = fakes();
    const state: SendState = { sentMessageIds: [], reacted: false, silenced: false };
    const tools = createSendTools(f.channel, f.target, state, "-# noyau-gpt-oss-120b");
    await tools.sendReply.execute({ content: "un" }, opts);
    await tools.sendMessage.execute({ content: "deux" }, opts);
    expect(f.reply).toHaveBeenCalledWith({ content: "un\n-# noyau-gpt-oss-120b" });
    expect(f.send).toHaveBeenCalledWith({ content: "deux" });
    expect(state.sentMessageIds).toEqual(["r1", "s2"]);
  });

  it("keeps messages within Discord's limit, tag included", async () => {
    const f = fakes();
    const tools = createSendTools(f.channel, f.target, { sentMessageIds: [], reacted: false, silenced: false }, "-# tag");
    await tools.sendMessage.execute({ content: "x".repeat(3000) }, opts);
    const sent = f.send.mock.calls[0]?.[0].content ?? "";
    expect(sent.length).toBe(2000);
    expect(sent.endsWith("\n-# tag")).toBe(true);
  });

  it("reacts without counting as a message", async () => {
    const f = fakes();
    const state: SendState = { sentMessageIds: [], reacted: false, silenced: false };
    await createSendTools(f.channel, f.target, state).addReaction.execute({ emoji: "😂" }, opts);
    expect(f.react).toHaveBeenCalledWith("😂");
    expect(state).toEqual({ sentMessageIds: [], reacted: true, silenced: false });
  });
});

describe("staySilent", () => {
  it("marks the run as a deliberate silence", async () => {
    const f = fakes();
    const state: SendState = { sentMessageIds: [], reacted: false, silenced: false };
    await createSendTools(f.channel, f.target, state).staySilent.execute({ reason: "rien à dire" }, opts);
    expect(state.silenced).toBe(true);
    expect(f.reply).not.toHaveBeenCalled();
  });
});
