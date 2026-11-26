import { normaliseName } from "./directory.ts";

// What Whisper writes when someone says its name at the start of a sentence.
const WAKE_WORDS = ["archive", "archives", "archiv", "archi", "a9", "a 9", "archive 9", "archive neuf", "hey archive", "eh archive", "ok archive", "dis archive"];

// Little words people (or speech recognition) put before the name.
const FILLERS = new Set(["euh", "heu", "bon", "alors", "eh", "he", "hey", "oh", "ok", "okay", "dis", "dites", "yo", "a", "ah"]);

const fold = (word: string) => normaliseName(word.replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/-/g, " "));

/**
 * « Archive, tu dors ? » → « tu dors ? ». Null when the sentence doesn't start with its
 * name (after a filler or two such as « euh »): in voice, only that wakes it up, besides a
 * direct follow-up.
 */
export function wakeWord(transcript: string): string | null {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  let skip = 0;
  while (skip < 2 && skip < words.length - 1 && FILLERS.has(fold(words[skip] ?? ""))) skip += 1;
  const found = nameAt(words, skip);
  if (found !== null) return found;
  // A short misheard word before the name (« Peur Archive, … »), when a comma follows it.
  const next = words[skip + 1] ?? "";
  if (skip === 0 && fold(words[0] ?? "").length <= 4 && /[,!.]$/.test(next)) return nameAt(words, 1);
  return null;
}

function nameAt(words: string[], skip: number): string | null {
  for (let n = Math.min(3, words.length - skip); n >= 1; n--) {
    const head = fold(words.slice(skip, skip + n).join(" "));
    // « j'archive » is a verb, not its name.
    const elided = /['’]/.test(words[skip] ?? "");
    if (WAKE_WORDS.includes(head) || (n === 1 && !elided && closeToName(head))) return words.slice(skip + n).join(" ").replace(/^[\s,.!?:;-]+/, "");
  }
  return null;
}

/** « achive », « archiv » or « arcive »: one letter off « archive(s) ». */
function closeToName(word: string): boolean {
  return word.length >= 6 && ["archive", "archives"].some((name) => editDistance(word, name) <= 1);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] ?? 0;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

/** What a speech synthesis can read: no markdown, links, tags or emoji, and not too long. */
export function speakable(text: string, names: ReadonlyMap<string, string> = new Map(), max = 400): string {
  const clean = text
    .replace(/<@!?(\d+)>/g, (_, id: string) => names.get(id) ?? "quelqu'un")
    .replace(/<#\d+>/g, "ce salon")
    .replace(/<a?:(\w+):\d+>/g, "")
    .replace(/https?:\/\/\S+/g, "le lien")
    .replace(/-# .*$/gm, "")
    .replace(/[*_~`>|#]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** Reads a PCM WAV file (16-bit): its sample rate, channels and samples. */
export function readWav(bytes: Uint8Array): { rate: number; channels: number; samples: Int16Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (text(0) !== "RIFF" || text(8) !== "WAVE") throw new Error("not a WAV file");
  let at = 12;
  let rate = 0;
  let channels = 0;
  while (at + 8 <= bytes.length) {
    const id = text(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      if (view.getUint16(at + 22, true) !== 16) throw new Error("only 16-bit WAV");
    } else if (id === "data") {
      const end = Math.min(bytes.length, at + 8 + size);
      const samples = new Int16Array(Math.floor((end - at - 8) / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(at + 8 + i * 2, true);
      return { rate, channels, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no audio data");
}

/** Any 16-bit PCM to 48 kHz stereo interleaved, what Discord plays. */
export function toDiscordPcm(samples: Int16Array, rate: number, channels: number): Int16Array {
  const frames = Math.floor(samples.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c] ?? 0;
    mono[i] = sum / channels;
  }
  const outFrames = Math.floor((frames * 48_000) / rate);
  const out = new Int16Array(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    const pos = (i * rate) / 48_000;
    const j = Math.floor(pos);
    const t = pos - j;
    const value = Math.round((mono[j] ?? 0) * (1 - t) + (mono[Math.min(j + 1, frames - 1)] ?? 0) * t);
    out[i * 2] = value;
    out[i * 2 + 1] = value;
  }
  return out;
}

/** What Discord gives (48 kHz stereo PCM) as a 16 kHz mono WAV, what speech recognition wants. */
export function toSpeechWav(pcm: Int16Array): Uint8Array {
  const frames = Math.floor(pcm.length / 2 / 3);
  const out = new Uint8Array(44 + frames * 2);
  const view = new DataView(out.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    // Average the three stereo frames that make one output sample: a cheap low-pass.
    let sum = 0;
    for (let k = 0; k < 3; k++) sum += ((pcm[(i * 3 + k) * 2] ?? 0) + (pcm[(i * 3 + k) * 2 + 1] ?? 0)) / 2;
    view.setInt16(44 + i * 2, Math.round(sum / 3), true);
  }
  return out;
}

/** Seconds of sound in 48 kHz stereo PCM. */
export function pcmSeconds(pcm: Int16Array): number {
  return pcm.length / 2 / 48_000;
}
