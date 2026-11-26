import { describe, expect, it } from "vitest";
import { transcribe } from "./hearing.ts";

const wav = new Uint8Array(44);
const reply = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("hearing", () => {
  it("returns what was said, billed 10 seconds at least", async () => {
    const heard = await transcribe({ groqApiKey: "k" }, wav, 3, reply(200, { text: " Archive, salut. " }));
    expect(heard.text).toBe("Archive, salut.");
    expect(heard.usage).toMatchObject({ task: "voice", provider: "groq", model: "whisper-large-v3-turbo", status: "ok" });
    expect(heard.usage.costUsd).toBeCloseTo((10 / 3600) * 0.04);
    expect((await transcribe({ groqApiKey: "k" }, wav, 36, reply(200, { text: "x" }))).usage.costUsd).toBeCloseTo(0.0004);
  });

  it("gives nothing for silence, refusals and network errors", async () => {
    expect((await transcribe({ groqApiKey: "k" }, wav, 1, reply(200, { text: "  " }))).text).toBeNull();
    expect((await transcribe({ groqApiKey: "k" }, wav, 1, reply(429, {}))).usage).toMatchObject({ status: "rate_limited", costUsd: 0 });
    expect((await transcribe({ groqApiKey: "k" }, wav, 1, reply(400, { error: { message: "bad audio" } }))).usage.error).toBe("bad audio");
    expect((await transcribe({ groqApiKey: "k" }, wav, 1, () => Promise.reject(new Error("offline")))).usage).toMatchObject({ status: "error", error: "offline" });
  });
});
