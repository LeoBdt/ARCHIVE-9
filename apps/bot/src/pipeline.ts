import { randomUUID } from "node:crypto";
import {
  INITIAL_SELF_STATE,
  pickOfflineLine,
  reply,
  shortModelName,
  triage,
  type AiRuntime,
  type Participant,
  type UsageRecord,
} from "@archive-9/ai";
import {
  AGENTS_BOT_LOOP_LIMITS,
  AmbientBudget,
  BotLoopGuard,
  KeyedDebouncer,
  createMemberFinder,
  createNameMatcher,
  decideIngress,
  formatTranscript,
  selectSkills,
  type TranscriptMessage,
} from "@archive-9/core";
import {
  activeSkills,
  aiCostSince,
  currentSelfState,
  lastMessageAt,
  memberContexts,
  memberDirectory,
  optedOutIds,
  recentMessages,
  recentWithMember,
  recordAiUsage,
  recordInteraction,
  recordSkillUse,
  type AiUsageInput,
  type Database,
  type DirectoryMember,
} from "@archive-9/db";
import type { Message, SendableChannels } from "discord.js";
import { createSendTools, type SendState } from "./discord/send-tools.ts";
import { keepTyping } from "./discord/typing.ts";
import { isInAgents } from "./discord/zone.ts";
import { loadServerContext, type ServerSource } from "./learning/server.ts";
import type { Logger } from "./logger.ts";
import type { SettingsStore } from "./settings.ts";
import { createReplyTools } from "./tools/index.ts";

export interface PipelineDeps {
  db: Database;
  ai: AiRuntime;
  settings: SettingsStore;
  log: Logger;
  selfId: string;
  knownAiBotIds: Set<string>;
  aliases: string[];
  softAliases: string[];
  timezone: string;
  server: ServerSource;
  agentsCategoryId: string | null;
  replyDailyBudgetUsd: number;
  /** « Novahe (a1b2c3d) », stored with every AI call. */
  version: string;
  startedAt: Date;
}

const TRIAGE_WINDOW = 10;
const REPLY_WINDOW = 20;
const ACTIVE_CONVERSATION_MS = 3 * 60_000;
const DIRECT_FOLLOW_UP_MS = 2 * 60_000;
const SHORT_MEMORY_MS = 6 * 60 * 60_000;
const SHORT_MEMORY_MESSAGES = 10;
const DIRECTORY_TTL_MS = 10 * 60_000;
/** People tagged or named in the conversation whose profile is added to the reply prompt. */
const MAX_MENTIONED = 5;
const DAY_MS = 24 * 60 * 60_000;

interface Directory {
  loadedAt: number;
  byId: Map<string, DirectoryMember>;
  names: Map<string, string>;
  find: (content: string, limit?: number) => string[];
}

interface Exchange {
  at: number;
  withAuthorId: string;
  withName: string;
  interrupted: boolean;
  /** Names of those who wrote since ARCHIVE-9's last message. */
  since: string[];
}

function channelOf(message: Message): SendableChannels | null {
  return message.channel.isSendable() ? message.channel : null;
}

function parentIdOf(message: Message): string | null {
  return "parentId" in message.channel ? message.channel.parentId : null;
}

function toTranscript(message: Message, selfId: string): TranscriptMessage {
  return {
    id: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    authorIsBot: message.author.bot,
    isSelf: message.author.id === selfId,
    content: message.content,
    replyToId: message.reference?.messageId ?? null,
    replyToAuthorName: message.mentions.repliedUser?.globalName ?? message.mentions.repliedUser?.username ?? null,
    replyToIsSelf: message.mentions.repliedUser?.id === selfId,
    createdAt: message.createdAt,
  };
}

/** Decides what to do with each incoming message and produces ARCHIVE-9's replies. */
export class Pipeline {
  private readonly deps: PipelineDeps;
  private readonly namesSelf: (content: string) => boolean;
  private readonly softNamesSelf: (content: string) => boolean;
  private readonly ambientBudget = new AmbientBudget();
  // Bots only reach a reply in AGENTS (or DM), so the AGENTS limits are the only ones needed.
  private readonly loopGuard = new BotLoopGuard(AGENTS_BOT_LOOP_LIMITS);
  private budgetWarnedAt = 0;
  private readonly busyChannels = new Set<string>();
  private readonly pending = new Map<string, Message>();
  private readonly lastExchange = new Map<string, Exchange>();
  private readonly debouncer: KeyedDebouncer;
  private cachedDirectory: Directory | null = null;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
    this.namesSelf = createNameMatcher(deps.aliases);
    this.softNamesSelf = createNameMatcher(deps.softAliases);
    this.debouncer = new KeyedDebouncer(deps.settings.value.debounceMs, (channelId) => {
      void this.flushBurst(channelId);
    });
  }

  stop(): void {
    this.debouncer.clear();
  }

  async handle(message: Message): Promise<void> {
    const { settings, selfId, knownAiBotIds } = this.deps;
    const isDm = message.guildId === null;
    if (!message.author.bot) this.loopGuard.onHumanMessage(message.channelId);
    const exchange = this.lastExchange.get(message.channelId);
    const continuesExchange =
      exchange !== undefined &&
      !exchange.interrupted &&
      exchange.withAuthorId === message.author.id &&
      Date.now() - exchange.at < DIRECT_FOLLOW_UP_MS;
    if (exchange && message.author.id !== selfId) {
      if (message.author.id !== exchange.withAuthorId) exchange.interrupted = true;
      const name = `${message.member?.displayName ?? message.author.username}${message.author.bot ? " [bot]" : ""}`;
      if (!exchange.since.includes(name)) exchange.since.push(name);
    }

    const optedOut = (await optedOutIds(this.deps.db, [message.author.id])).has(message.author.id);
    const decision = decideIngress(
      {
        content: message.content,
        isDm,
        isFromSelf: message.author.id === selfId,
        authorIsBot: message.author.bot,
        authorIsKnownAiBot: knownAiBotIds.has(message.author.id),
        mentionsSelf: message.mentions.users.has(selfId),
        namesSelf: this.namesSelf(message.content),
        softNamesSelf: this.softNamesSelf(message.content),
        repliesToSelf: message.mentions.repliedUser?.id === selfId,
        continuesExchange,
      },
      {
        inAgents: isInAgents(message.channel, this.deps.agentsCategoryId),
        paused: settings.value.paused,
        authorOptedOut: optedOut,
        channelListened: settings.isListened(message.channelId, parentIdOf(message)),
        spontaneity: settings.value.spontaneity,
        inActiveConversation: Date.now() - (exchange?.at ?? 0) < ACTIVE_CONVERSATION_MS,
      },
    );

    if (decision.action === "ignore") {
      // A mention that gets no answer is worth seeing in the normal logs.
      const level = message.mentions.users.has(selfId) && decision.reason !== "self" ? "info" : "trace";
      this.deps.log[level]({ messageId: message.id, channelId: message.channelId, reason: decision.reason }, "ignored");
      return;
    }
    if (decision.fromBot) {
      const check = this.loopGuard.check(message.channelId);
      if (!check.allowed) {
        this.deps.log.debug({ channelId: message.channelId, reason: check.reason }, "bot loop guard");
        return;
      }
    }
    if (decision.action === "reply") {
      this.debouncer.cancel(message.channelId);
      this.pending.delete(message.channelId);
      await this.respond(message, { addressed: true, runId: randomUUID(), triageReason: null, usage: [] });
      return;
    }
    // Within a burst, a bot answering right after a human must not take the human's place.
    const queued = this.pending.get(message.channelId);
    if (!(message.author.bot && queued && !queued.author.bot)) this.pending.set(message.channelId, message);
    this.debouncer.schedule(message.channelId);
  }

  private async flushBurst(channelId: string): Promise<void> {
    const target = this.pending.get(channelId);
    this.pending.delete(channelId);
    if (!target || this.deps.settings.value.paused) return;
    if (this.busyChannels.has(channelId)) return;

    const { db, ai, selfId, log } = this.deps;
    try {
      const runId = randomUUID();
      const history = await recentMessages(db, channelId, selfId, TRIAGE_WINDOW);
      const outcome = await triage(ai, {
        transcript: formatTranscript(history, {
          targetId: target.id,
          maxContentLength: 300,
          timeZone: this.deps.timezone,
          names: (await this.directory()).names,
        }),
        channelName: "name" in target.channel ? target.channel.name : null,
        conversationNote: await this.conversationNote(target),
      });

      const { decision } = outcome;
      const detail = decision
        ? `adressé : ${decision.addressed ? "oui" : "non"} · intérêt ${String(decision.interest)}/10 · ${decision.reason}`
        : null;
      await this.saveUsage(runId, outcome.usage, { detail });
      log.debug({ channelId, decision }, "triage");
      if (!decision) return;

      if (decision.addressed) {
        await this.respond(target, { addressed: true, runId, triageReason: decision.reason, usage: [] });
        return;
      }
      const level = this.deps.settings.value.spontaneity;
      if (!this.ambientBudget.allows(channelId, level, decision.interest)) return;
      const spoke = await this.respond(target, {
        addressed: false,
        runId,
        triageReason: `intérêt ${String(decision.interest)}/10 : ${decision.reason}`,
        usage: [],
      });
      if (spoke) this.ambientBudget.record(channelId);
    } catch (error) {
      log.error({ err: error, channelId }, "triage failed");
    }
  }

  /** Facts the code knows for sure, so the triage model doesn't have to guess them. */
  private async conversationNote(target: Message): Promise<string> {
    const notes: string[] = [];
    const exchange = this.lastExchange.get(target.channelId);
    if (exchange && Date.now() - exchange.at < ACTIVE_CONVERSATION_MS) {
      const seconds = Math.round((Date.now() - exchange.at) / 1000);
      const since = exchange.since.length ? ` Depuis, ont écrit : ${exchange.since.join(", ")}.` : "";
      notes.push(`ARCHIVE-9 est dans la conversation : il a parlé il y a ${String(seconds)} s, en répondant à ${exchange.withName}.${since}`);
    } else {
      const last = await lastMessageAt(this.deps.db, target.channelId, this.deps.selfId);
      notes.push(
        last
          ? `ARCHIVE-9 n'est pas dans la conversation (dernière intervention ici il y a ${String(Math.round((Date.now() - last.getTime()) / 60_000))} min).`
          : "ARCHIVE-9 n'a encore jamais parlé dans ce salon.",
      );
    }
    const replied = target.mentions.repliedUser;
    if (replied && replied.id !== this.deps.selfId) {
      notes.push(`Le message cible est une réponse Discord à ${replied.globalName ?? replied.username}, pas à ARCHIVE-9.`);
    }
    if (this.softNamesSelf(target.content)) {
      notes.push("Le mot « archive » apparaît dans le message cible : son nom, ou un simple verbe ?");
    }
    return notes.join(" ");
  }

  private async respond(
    target: Message,
    run: { addressed: boolean; runId: string; triageReason: string | null; usage: UsageRecord[] },
  ): Promise<boolean> {
    const channel = channelOf(target);
    if (!channel || this.busyChannels.has(target.channelId)) return false;
    this.busyChannels.add(target.channelId);
    // An unprompted intervention may end in silence, so it doesn't announce itself.
    const stopTyping = run.addressed ? keepTyping(channel) : () => undefined;

    try {
      const { db, ai, selfId, settings, log } = this.deps;
      const isDm = target.guildId === null;
      const inAgents = isInAgents(target.channel, this.deps.agentsCategoryId);
      const spent = await aiCostSince(db, ["reply"], new Date(Date.now() - DAY_MS));
      const overBudget = spent >= this.deps.replyDailyBudgetUsd;
      if (overBudget) {
        if (Date.now() - this.budgetWarnedAt > 60 * 60_000) {
          this.budgetWarnedAt = Date.now();
          log.warn({ spent, budget: this.deps.replyDailyBudgetUsd }, "reply budget spent: humans only, free models only");
        }
        if (!run.addressed || target.author.bot) return false;
      }
      const history = isDm
        ? [...(await target.channel.messages.fetch({ limit: REPLY_WINDOW })).values()].map((m) => toTranscript(m, selfId))
        : await recentMessages(db, target.channelId, selfId, REPLY_WINDOW);
      if (!history.some((m) => m.id === target.id)) history.push(toTranscript(target, selfId));

      const directory = await this.directory();
      const participants = await this.participants(history, target, directory);
      const elsewhere = await this.elsewhere(target, history);
      const send: SendState = { sentMessageIds: [], reacted: false, silenced: false };
      const skills = selectSkills(await activeSkills(db), target.content);
      const outcome = await reply(
        ai,
        {
          now: new Date(),
          timezone: this.deps.timezone,
          channelName: "name" in target.channel ? target.channel.name : null,
          isDm,
          inAgents,
          addressed: run.addressed,
          targetId: target.id,
          targetAuthorId: target.author.id,
          triageReason: run.triageReason,
          transcript: formatTranscript(history, { targetId: target.id, timeZone: this.deps.timezone, names: directory.names }),
          names: directory.names,
          participants,
          elsewhere,
          server: isDm || target.guildId === this.deps.server.id ? await loadServerContext(db, this.deps.server) : undefined,
          selfState: await currentSelfState(db, INITIAL_SELF_STATE),
          skills,
          version: { label: this.deps.version, since: this.deps.startedAt },
        },
        (ref, isFallback) => ({
          ...createSendTools(channel, target, send, isFallback && settings.value.showFallbackTag ? `-# noyau-${shortModelName(ref)}` : undefined),
          ...createReplyTools({
            db,
            ai,
            log,
            settings,
            target,
            channel,
            send,
            selfId,
            guildId: this.deps.server.id,
            agentsCategoryId: this.deps.agentsCategoryId,
            addressed: run.addressed,
            timezone: this.deps.timezone,
            names: directory.names,
            directory: directory.byId,
            findMembers: directory.find,
            saveUsage: (usage, detail) => this.saveUsage(run.runId, usage, { detail }),
          }),
        }),
        { freeOnly: overBudget },
      );

      if (!outcome.ok) {
        if (run.addressed) {
          const sent = await target.reply(pickOfflineLine());
          send.sentMessageIds.push(sent.id);
        }
        await this.saveUsage(run.runId, outcome.usage, { replyMessageIds: send.sentMessageIds, detail: "offline" });
        return send.sentMessageIds.length > 0;
      }

      // Safety net: when addressed, text written outside the tools is still what it meant to say.
      const strayText = outcome.result.text.trim();
      if (run.addressed && strayText && send.sentMessageIds.length === 0 && !send.silenced) {
        const tag = outcome.isFallback && settings.value.showFallbackTag ? `\n-# noyau-${shortModelName(outcome.ref)}` : "";
        const sent = await target.reply(`${strayText.slice(0, 2000 - tag.length)}${tag}`);
        send.sentMessageIds.push(sent.id);
      }

      const toolsCalled = outcome.result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
      await this.saveUsage(run.runId, outcome.usage, {
        replyMessageIds: send.sentMessageIds,
        detail: toolsCalled.length ? toolsCalled.join(", ") : "silence",
      });

      if (send.sentMessageIds.length > 0 || send.reacted) {
        this.lastExchange.set(target.channelId, {
          at: Date.now(),
          withAuthorId: target.author.id,
          withName: target.member?.displayName ?? target.author.username,
          interrupted: false,
          since: [],
        });
        await recordInteraction(db, target.author.id);
        await recordSkillUse(db, skills.map((k) => k.id));
        if (target.author.bot) this.loopGuard.recordReplyToBot(target.channelId);
      }
      log.info(
        { channelId: target.channelId, model: outcome.ref.id, fallback: outcome.isFallback, sent: send.sentMessageIds.length },
        send.sentMessageIds.length ? "replied" : "stayed silent",
      );
      return send.sentMessageIds.length > 0 || send.reacted;
    } catch (error) {
      this.deps.log.error({ err: error, messageId: target.id }, "reply failed");
      return false;
    } finally {
      stopTyping();
      this.busyChannels.delete(target.channelId);
    }
  }

  /** Short memory: what the target author said lately outside this conversation. */
  private async elsewhere(target: Message, history: TranscriptMessage[]) {
    const recent = await recentWithMember(this.deps.db, this.deps.selfId, target.author.id, {
      since: new Date(Date.now() - SHORT_MEMORY_MS),
      excludeIds: history.map((m) => m.id),
      limit: SHORT_MEMORY_MESSAGES,
    });
    const places = new Map<string, { where: string; messages: TranscriptMessage[] }>();
    for (const message of recent) {
      let place = places.get(message.channelId);
      if (!place) {
        const channel = target.client.channels.cache.get(message.channelId);
        const name = channel && "name" in channel ? channel.name : null;
        const where =
          message.guildId === null ? "en message privé" : message.channelId === target.channelId ? "plus tôt ici" : `#${name ?? "un autre salon"}`;
        place = { where, messages: [] };
        places.set(message.channelId, place);
      }
      place.messages.push(message);
    }
    return [...places.values()];
  }

  /** Names of every member, refreshed every few minutes, to resolve tags and nicknames. */
  private async directory(): Promise<Directory> {
    if (this.cachedDirectory && Date.now() - this.cachedDirectory.loadedAt < DIRECTORY_TTL_MS) return this.cachedDirectory;
    const members = await memberDirectory(this.deps.db);
    this.cachedDirectory = {
      loadedAt: Date.now(),
      byId: new Map(members.map((m) => [m.id, m])),
      names: new Map(members.map((m) => [m.id, m.name])),
      find: createMemberFinder(members),
    };
    return this.cachedDirectory;
  }

  /**
   * Everyone who wrote in the window, plus the people the target message tags or names
   * ("parle-moi de jp") and those tagged earlier, so their profile is at hand.
   */
  private async participants(history: TranscriptMessage[], target: Message, directory: Directory): Promise<Participant[]> {
    const { selfId } = this.deps;
    const people = new Map<string, { name: string; isBot: boolean }>();
    for (const m of history) if (!m.isSelf) people.set(m.authorId, { name: m.authorName, isBot: m.authorIsBot });
    people.set(target.author.id, { name: target.member?.displayName ?? target.author.username, isBot: target.author.bot });
    const mentioned = [
      ...target.mentions.users.keys(),
      ...directory.find(target.content, MAX_MENTIONED),
      ...history.flatMap((m) => ("mentionedIds" in m && Array.isArray(m.mentionedIds) ? (m.mentionedIds as string[]) : [])),
    ];
    let added = 0;
    for (const id of mentioned) {
      const member = directory.byId.get(id);
      if (added >= MAX_MENTIONED || id === selfId || people.has(id) || !member) continue;
      people.set(id, { name: member.name, isBot: member.isBot });
      added += 1;
    }
    const contexts = await memberContexts(this.deps.db, [...people.keys()]);
    return [...people].map(([id, info]) => {
      const ctx = contexts.get(id);
      return {
        id,
        name: info.name,
        isBot: info.isBot,
        summary: ctx?.summary ?? null,
        affinity: ctx?.affinity ?? null,
        trust: ctx?.trust ?? null,
        feeling: ctx?.feeling ?? null,
        introduced: ctx?.introduced ?? false,
      };
    });
  }

  private async saveUsage(
    runId: string,
    usage: UsageRecord[],
    extra: { replyMessageIds?: string[]; detail?: string | null },
  ): Promise<void> {
    const rows: AiUsageInput[] = usage.map((record, index) => ({
      ...record,
      runId,
      detail: record.status === "ok" ? (extra.detail ?? null) : null,
      replyMessageIds: index === usage.length - 1 ? (extra.replyMessageIds ?? []) : [],
      version: this.deps.version,
    }));
    if (rows.length === 0 && extra.replyMessageIds?.length) {
      rows.push({
        runId,
        task: "reply",
        provider: "none",
        model: "offline",
        upstreamProvider: null,
        fallbackReason: "all providers unavailable",
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        durationMs: 0,
        status: "error",
        error: null,
        detail: extra.detail ?? null,
        replyMessageIds: extra.replyMessageIds,
        version: this.deps.version,
      });
    }
    await recordAiUsage(this.deps.db, rows).catch((err: unknown) => {
      this.deps.log.warn({ err }, "could not record AI usage");
    });
  }
}
