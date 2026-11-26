import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { INITIAL_SELF_STATE, reply, transcribe, triage, type AiRuntime, type HearingConfig, type UsageRecord } from "@archive-9/ai";
import { formatTranscript, pcmSeconds, readWav, speakable, toDiscordPcm, toSpeechWav, wakeWord, type TranscriptMessage } from "@archive-9/core";
import { aiCostSince, currentSelfState, memberContexts, recordAiUsage, type Database } from "@archive-9/db";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  EndBehaviorType,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import { tool } from "ai";
import type { VoiceBasedChannel } from "discord.js";
import prism from "prism-media";
import { z } from "zod";
import type { Logger } from "../logger.ts";

export interface VoiceDeps {
  db: Database;
  ai: AiRuntime;
  log: Logger;
  selfId: string;
  timezone: string;
  hearing: HearingConfig;
  /** The Piper container, e.g. `http://piper:5000`. */
  piperUrl: string;
  dailyBudgetUsd: number;
  version: string;
}

/** Shorter than this is a cough, longer is cut. */
const MIN_SECONDS = 0.6;
const MAX_SECONDS = 30;
/** Silence that ends what someone is saying. */
const END_OF_SPEECH_MS = 900;
/** After it spoke, a sentence without its name may still be for it. */
const FOLLOW_UP_MS = 25_000;
/** Nobody spoke for this long: it leaves. */
const IDLE_MS = 15 * 60_000;
const TRANSCRIPT_LINES = 24;
const DAY_MS = 24 * 60 * 60_000;

/** One stay in a voice channel: it listens to each person, answers its name and the follow-ups. */
export class VoiceSession {
  readonly channel: VoiceBasedChannel;
  private readonly deps: VoiceDeps;
  private readonly connection: VoiceConnection;
  private readonly player: AudioPlayer = createAudioPlayer();
  private readonly listening = new Set<string>();
  private readonly lines: TranscriptMessage[] = [];
  private lastSpoke: { at: number; toId: string; othersSince: boolean } | null = null;
  private lastHeardAt = Date.now();
  private busy = false;
  private queued: TranscriptMessage | null = null;
  private idle: ReturnType<typeof setInterval>;
  private closed = false;
  onClose: (() => void) | null = null;

  constructor(deps: VoiceDeps, channel: VoiceBasedChannel) {
    this.deps = deps;
    this.channel = channel;
    this.connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
    this.connection.subscribe(this.player);
    this.connection.receiver.speaking.on("start", (userId) => {
      this.listen(userId);
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      // Moved or kicked: give it a few seconds to reconnect, otherwise it's over.
      void Promise.race([entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000), entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)]).catch(() => {
        this.close("disconnected");
      });
    });
    this.idle = setInterval(() => {
      if (Date.now() - this.lastHeardAt > IDLE_MS) void this.leave("Bon, plus personne ne parle. Je vous laisse.");
    }, 60_000);
  }

  async ready(): Promise<void> {
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  /** Says hello and how to talk to it. */
  async greet(): Promise<void> {
    await this.say("Salut, ARCHIVE-9 en ligne. Dites « archive » au début de votre phrase pour me parler.");
  }

  async leave(goodbye?: string): Promise<void> {
    if (this.closed) return;
    if (goodbye) await this.say(goodbye).catch(() => undefined);
    this.close("left");
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.idle);
    this.player.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.deps.log.info({ channelId: this.channel.id, reason }, "left voice");
    this.onClose?.();
  }

  /** Humans still in the channel, itself left out. */
  humans(): number {
    return this.channel.members.filter((m) => !m.user.bot).size;
  }

  private listen(userId: string): void {
    if (this.closed || this.listening.has(userId) || userId === this.deps.selfId) return;
    const member = this.channel.members.get(userId);
    if (!member || member.user.bot) return;
    this.listening.add(userId);
    const opus = this.connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: END_OF_SPEECH_MS } });
    const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    const chunks: Buffer[] = [];
    let size = 0;
    const limit = MAX_SECONDS * 48_000 * 2 * 2;
    opus.pipe(decoder);
    decoder.on("data", (chunk: Buffer) => {
      if (size < limit) {
        chunks.push(chunk);
        size += chunk.length;
      }
    });
    const done = () => {
      this.listening.delete(userId);
      const buffer = Buffer.concat(chunks);
      const pcm = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));
      if (pcmSeconds(pcm) >= MIN_SECONDS) void this.heard(userId, member.displayName, pcm);
    };
    decoder.once("end", done);
    decoder.once("error", (err) => {
      this.deps.log.debug({ err, userId }, "voice decode error");
      this.listening.delete(userId);
    });
  }

  private async heard(userId: string, name: string, pcm: Int16Array): Promise<void> {
    const { db, log } = this.deps;
    try {
      if ((await aiCostSince(db, ["voice"], new Date(Date.now() - DAY_MS))) >= this.deps.dailyBudgetUsd) {
        log.warn("voice budget spent for today");
        return;
      }
      const heard = await transcribe(this.deps.hearing, toSpeechWav(pcm), pcmSeconds(pcm));
      await this.record([heard.usage], "vocal : transcription");
      if (!heard.text) return;
      this.lastHeardAt = Date.now();
      const line: TranscriptMessage = {
        id: `v${randomUUID().slice(0, 8)}`,
        authorId: userId,
        authorName: name,
        authorIsBot: false,
        isSelf: false,
        content: heard.text,
        replyToId: null,
        createdAt: new Date(),
      };
      this.push(line);
      if (this.lastSpoke && userId !== this.lastSpoke.toId) this.lastSpoke.othersSince = true;
      log.debug({ userId, text: heard.text }, "heard");
      if (this.busy) {
        // It is already answering: keep only the latest sentence for after.
        if (wakeWord(heard.text) !== null) this.queued = line;
        return;
      }
      await this.decide(line);
    } catch (err) {
      log.warn({ err }, "voice turn failed");
    }
  }

  /** Its name at the start, or a direct follow-up; when unsure, the small model decides. */
  private async decide(line: TranscriptMessage): Promise<void> {
    const named = wakeWord(line.content) !== null;
    const recent = this.lastSpoke !== null && Date.now() - this.lastSpoke.at < FOLLOW_UP_MS;
    const direct = recent && this.lastSpoke?.toId === line.authorId && !this.lastSpoke.othersSince;
    let addressed = named || direct;
    if (!addressed && recent) {
      const outcome = await triage(this.deps.ai, {
        transcript: formatTranscript(this.lines.slice(-10), { targetId: line.id, timeZone: this.deps.timezone }),
        channelName: `vocal ${this.channel.name}`,
        conversationNote: "Conversation vocale, transcrite par reconnaissance vocale. ARCHIVE-9 vient de parler : ce message lui répond-il, sans dire son nom ?",
      });
      await this.record(outcome.usage, "vocal : tri");
      addressed = outcome.decision?.addressed ?? false;
    }
    if (addressed) await this.answer(line);
  }

  private async answer(target: TranscriptMessage): Promise<void> {
    const { db, ai, selfId } = this.deps;
    this.busy = true;
    try {
      const people = [...new Set(this.lines.filter((l) => !l.isSelf).map((l) => l.authorId))];
      const contexts = await memberContexts(db, people);
      const names = new Map(this.lines.map((l) => [l.authorId, l.authorName]));
      // Filled by the tool while the model runs.
      const spoken: { text: string | null } = { text: null };
      const outcome = await reply(
        ai,
        {
          now: new Date(),
          timezone: this.deps.timezone,
          channelName: this.channel.name,
          isDm: false,
          inAgents: true,
          addressed: true,
          targetId: target.id,
          targetAuthorId: target.authorId,
          triageReason: null,
          transcript: formatTranscript(this.lines, { targetId: target.id, timeZone: this.deps.timezone }),
          names,
          participants: people.map((id) => {
            const c = contexts.get(id);
            return { id, name: names.get(id) ?? id, isBot: false, summary: c?.summary ?? null, affinity: c?.affinity ?? null, trust: c?.trust ?? null, feeling: c?.feeling ?? null, introduced: true };
          }),
          selfState: await currentSelfState(db, INITIAL_SELF_STATE),
          version: { label: this.deps.version, since: new Date() },
          voice: { channelName: this.channel.name },
        },
        () => ({
          sendReply: tool({
            description: "Dit ta réponse à voix haute dans le salon vocal.",
            inputSchema: z.object({ content: z.string().min(1).describe("ce que tu dis, à l'oral, une ou deux phrases") }),
            execute: async ({ content }) => {
              spoken.text = speakable(content, names);
              await this.say(spoken.text);
              return { said: true };
            },
          }),
          staySilent: tool({
            description: "Ne rien dire cette fois-ci.",
            inputSchema: z.object({ reason: z.string().max(200) }),
            execute: () => ({ silent: true }),
          }),
        }),
      );
      await this.record(outcome.usage, "vocal : réponse");
      if (spoken.text) {
        this.push({ id: `v${randomUUID().slice(0, 8)}`, authorId: selfId, authorName: "ARCHIVE-9", authorIsBot: true, isSelf: true, content: spoken.text, replyToId: target.id, replyToAuthorName: target.authorName, createdAt: new Date() });
        this.lastSpoke = { at: Date.now(), toId: target.authorId, othersSince: false };
      }
    } finally {
      this.busy = false;
      const next = this.queued;
      this.queued = null;
      if (next && !this.closed) void this.decide(next);
    }
  }

  /** Speaks a sentence with Piper and waits until it's said. */
  async say(text: string): Promise<void> {
    const sentence = speakable(text);
    if (!sentence || this.closed) return;
    const response = await fetch(this.deps.piperUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: sentence }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`piper ${String(response.status)}`);
    const wav = readWav(new Uint8Array(await response.arrayBuffer()));
    const pcm = toDiscordPcm(wav.samples, wav.rate, wav.channels);
    const resource = createAudioResource(Readable.from([Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]), { inputType: StreamType.Raw });
    this.player.play(resource);
    await entersState(this.player, AudioPlayerStatus.Playing, 5_000).catch(() => undefined);
    await entersState(this.player, AudioPlayerStatus.Idle, 60_000).catch(() => undefined);
  }

  private push(line: TranscriptMessage): void {
    this.lines.push(line);
    if (this.lines.length > TRANSCRIPT_LINES) this.lines.splice(0, this.lines.length - TRANSCRIPT_LINES);
  }

  private async record(usage: UsageRecord[], detail: string): Promise<void> {
    await recordAiUsage(this.deps.db, usage.map((u) => ({ ...u, runId: randomUUID(), detail, version: this.deps.version }))).catch(() => undefined);
  }
}

/** At most one voice channel at a time. */
export class VoiceManager {
  private readonly deps: VoiceDeps;
  private session: VoiceSession | null = null;

  constructor(deps: VoiceDeps) {
    this.deps = deps;
  }

  current(): VoiceSession | null {
    return this.session;
  }

  /** Joins this channel (leaving another one first) and says hello. */
  async join(channel: VoiceBasedChannel): Promise<void> {
    if (this.session?.channel.id === channel.id) return;
    await this.session?.leave();
    const session = new VoiceSession(this.deps, channel);
    session.onClose = () => {
      if (this.session === session) this.session = null;
    };
    this.session = session;
    try {
      await session.ready();
    } catch (err) {
      session.close("could not connect");
      throw err;
    }
    this.deps.log.info({ channelId: channel.id }, "joined voice");
    await session.greet().catch((err: unknown) => {
      this.deps.log.warn({ err }, "voice greeting failed");
    });
  }

  async leave(goodbye?: string): Promise<boolean> {
    if (!this.session) return false;
    await this.session.leave(goodbye);
    return true;
  }

  /** Someone left: alone in the channel, it goes too. */
  checkAlone(): void {
    if (this.session?.humans() === 0) this.session.close("alone");
  }

  stop(): void {
    this.session?.close("shutdown");
  }
}
