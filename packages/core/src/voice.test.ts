import { describe, expect, it } from "vitest";
import { pcmSeconds, readWav, speakable, toDiscordPcm, toSpeechWav, wakeWord } from "./voice.ts";

describe("its name in voice", () => {
  it("wakes up when a sentence starts with it", () => {
    expect(wakeWord("Archive, tu dors ?")).toBe("tu dors ?");
    expect(wakeWord("archives t'en penses quoi")).toBe("t'en penses quoi");
    expect(wakeWord("Hey Archive ! Raconte une blague.")).toBe("Raconte une blague.");
    expect(wakeWord("ARCHIVE-9 viens")).toBe("viens");
    expect(wakeWord("Archive.")).toBe("");
    expect(wakeWord("A. Archive, tu penses quoi ?")).toBe("tu penses quoi ?");
    expect(wakeWord("Euh archive t'es là ?")).toBe("t'es là ?");
    expect(wakeWord("Achive raconte moi une blague.")).toBe("raconte moi une blague.");
    expect(wakeWord("Peur Archive, t'es là !")).toBe("t'es là !");
  });

  it("stays asleep otherwise", () => {
    expect(wakeWord("j'archive mes photos")).toBeNull();
    expect(wakeWord("tu as vu archive hier ?")).toBeNull();
    expect(wakeWord("mes archives sont pleines")).toBeNull();
    expect(wakeWord("arcade ce soir ?")).toBeNull();
    expect(wakeWord("")).toBeNull();
    expect(wakeWord("euh bon alors archive")).toBeNull();
  });
});

describe("speakable text", () => {
  it("drops what can't be read aloud", () => {
    const names = new Map([["123", "Léa"]]);
    expect(speakable("**Salut** <@123> 😂 regarde https://a9.example/x\n-# noyau-gpt", names)).toBe("Salut Léa regarde le lien");
  });

  it("cuts long answers at a sentence", () => {
    const long = "Une phrase assez longue pour remplir. ".repeat(20);
    const said = speakable(long, new Map(), 120);
    expect(said.length).toBeLessThanOrEqual(120);
    expect(said.endsWith(".")).toBe(true);
  });
});

describe("audio", () => {
  it("reads a WAV and turns it into what Discord plays, and back", () => {
    const speech = toSpeechWav(new Int16Array(48_000 * 2).fill(1000));
    const wav = readWav(speech);
    expect(wav).toMatchObject({ rate: 16_000, channels: 1 });
    expect(wav.samples.length).toBe(16_000);
    expect(wav.samples[10]).toBe(1000);
    const pcm = toDiscordPcm(wav.samples, wav.rate, wav.channels);
    expect(pcmSeconds(pcm)).toBeCloseTo(1, 2);
    expect(pcm[100]).toBe(1000);
    expect(() => readWav(new Uint8Array(10))).toThrow();
  });
});
