import { randomUUID } from "node:crypto";
import {
  INITIAL_SELF_STATE,
  pickOfflineLine,
  embedTexts,
  reply,
  shortModelName,
  triage,
  type AiRuntime,
  type EmbeddingConfig,
  type Participant,
  type UsageRecord,
} from "@archive-9/ai";
import {
  AGENTS_BOT_LOOP_LIMITS,
  AmbientBudget,
  BotLoopGuard,
  KeyedDebouncer,
  cleanOutgoing,
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
  claimDmNotice,
  dmPrivateIds,
  imagesByMessage,
  pendingImages,
  similarFacts,
  vectorStoreReady,
  currentSelfState,
  lastMessageAt,
  memberContexts,
  memberDirectory,
  optedOutIds,
  pendingFeedback,
  preferencesFor,
  recentMessages,
  recentWithMember,
  recordAiUsage,
  recordDecision,
  recordInteraction,
  recordSkillUse,
  type DecisionInput,
  type DecisionDetails,
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
import { imagesOf } from "./ingest.ts";
import { describeImage, describePending, visionAllowed, type VisionDeps } from "./vision.ts";
import type { VoiceManager } from "./voice/session.ts";

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
  /** The site's public address, given to the model so it links it in full. */
  siteUrl: string | null;
  vision: VisionDeps;
  embedding?: EmbeddingConfig;
  voice?: VoiceManager;
}

type TriageDetails = NonNullable<DecisionDetails["triage"]>;

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
/** Images of the last half hour in the channel are looked at before replying. */
const FRESH_IMAGES_MS = 30 * 60_000;
const FRESH_IMAGES = 4;
/** Fragments recalled by meaning, on top of the dossier summaries. */
const RECALLED = 6;
/** Said once, in each person's first DM. */
export const DM_NOTICE = "-# Nos MP sont archivés comme le reste : j'en tire des fragments, visibles sur mon site. `/mp-prives` pour les garder hors de ma mémoire.";

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

function channelName(message: Message): string | null {
  return "name" in message.channel ? message.channel.name : null;
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
const SEND = new Set(["sendReply", "sendMessage"]);
const short = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
};

/** The « why » of a reply, as the journal shows it: context, reasoning, steps, what was sent. */
export function describeRun(
  result: { steps: { toolCalls: { toolName: string; input: unknown }[]; toolResults?: { toolName: string; output: unknown }[] }[]; reasoningText?: string | undefined },
  ctx: {
    participants: Participant[];
    authorId: string;
    skills: string[];
    resolutions: string[];
    mentionNote: string | null;
    fallback: string | null;
    freeOnly: boolean;
  },
) {
  const context: string[] = [];
  const author = ctx.participants.find((p) => p.id === ctx.authorId);
  if (author) {
    const relation = author.affinity === null ? "aucune relation encore" : `affinité ${String(author.affinity)}, confiance ${String(author.trust ?? 25)}${author.feeling ? `, « ${author.feeling} »` : ""}`;
    context.push(`${author.name} : ${relation}`);
    if (author.preferences?.length) context.push(`Ses préférences : ${author.preferences.join(" ; ")}`);
  }
  if (ctx.skills.length) context.push(`Skills appliquées : ${ctx.skills.join(", ")}`);
  if (ctx.resolutions.length) context.push(`Mes résolutions : ${ctx.resolutions.join(" ; ")}`);
  if (ctx.mentionNote) context.push("Le message s'adressait d'abord à quelqu'un d'autre");
  if (ctx.fallback) context.push(ctx.fallback);
  if (ctx.freeOnly) context.push("Budget du jour atteint : modèles gratuits seulement");

  const steps: { tool: string; summary: string }[] = [];
  const sent: string[] = [];
  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      const input = call.input as Record<string, unknown> | null;
      if (SEND.has(call.toolName) && typeof input?.content === "string") {
        sent.push(input.content);
        steps.push({ tool: call.toolName, summary: "message envoyé" });
        continue;
      }
      const output = step.toolResults?.find((r) => r.toolName === call.toolName)?.output;
      if (call.toolName === "addReaction" && typeof input?.emoji === "string") {
        steps.push({ tool: call.toolName, summary: input.emoji });
        continue;
      }
      steps.push({ tool: call.toolName, summary: output === undefined ? short(input) : short(output) });
    }
  }
  const reasoning = result.reasoningText?.trim();
  const people = ctx.participants
    .filter((p) => p.id === ctx.authorId || p.affinity !== null)
    .slice(0, 6)
    .map((p) => ({ id: p.id, name: p.name, affinity: p.affinity, trust: p.trust, feeling: p.feeling }));
  return { context, reasoning: reasoning ? reasoning.slice(0, 4000) : null, steps, sent: sent.length ? sent.join("\n") : null, people, skills: ctx.skills };
}

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
    const inAgents = isInAgents(message.channel, this.deps.agentsCategoryId);
    const decision = decideIngress(
      {
        content: message.content,
        isDm,
        isFromSelf: message.author.id === selfId,
        authorIsBot: message.author.bot,
        // In AGENTS every bot is an AI agent, listed or not.
        authorIsKnownAiBot: knownAiBotIds.has(message.author.id) || (message.author.bot && inAgents),
        mentionsSelf: message.mentions.users.has(selfId),
        namesSelf: this.namesSelf(message.content),
        softNamesSelf: this.softNamesSelf(message.content),
        repliesToSelf: message.mentions.repliedUser?.id === selfId,
        continuesExchange,
      },
      {
        inAgents,
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
      if (decision.reason !== "self") {
        this.decide({ messageId: message.id, channelId: message.channelId, channelName: channelName(message), guildId: message.guildId, authorId: message.author.id, outcome: "ignored", reason: decision.reason, inAgents });
      }
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
      const trigger = message.guildId === null
        ? "message privé"
        : message.mentions.users.has(selfId)
          ? "mention @ARCHIVE-9"
          : message.mentions.repliedUser?.id === selfId
            ? "réponse à un de mes messages"
            : continuesExchange
              ? "suite de notre échange"
              : "mon nom dans le message";
      await this.respond(message, { addressed: true, runId: randomUUID(), triageReason: null, usage: [], trigger });
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
      const used = outcome.usage.at(-1);
      const triageInfo: TriageDetails = {
        transcript: formatTranscript(history.slice(-8), { targetId: target.id, maxContentLength: 200, timeZone: this.deps.timezone, names: (await this.directory()).names }),
        reasoning: outcome.reasoning,
        addressed: decision.addressed,
        interest: decision.interest,
        reason: decision.reason,
        model: used ? (used.servedModel ?? used.model) : null,
        fallbackReason: used?.fallbackReason ?? null,
        durationMs: used?.durationMs ?? null,
        inputTokens: used?.inputTokens ?? null,
        outputTokens: used?.outputTokens ?? null,
      };

      if (decision.addressed) {
        await this.respond(target, { addressed: true, runId, triageReason: decision.reason, usage: [], trigger: `le tri : ${decision.reason}`, triage: triageInfo });
        return;
      }
      const level = this.deps.settings.value.spontaneity;
      if (!this.ambientBudget.allows(channelId, level, decision.interest)) {
        this.decide({
          runId,
          messageId: target.id,
          channelId,
          channelName: channelName(target),
          guildId: target.guildId,
          authorId: target.author.id,
          outcome: "silent",
          reason: decision.reason,
          interest: decision.interest,
          inAgents: isInAgents(target.channel, this.deps.agentsCategoryId),
          content: target.content,
          details: { triage: triageInfo },
        });
        return;
      }
      const spoke = await this.respond(target, {
        addressed: false,
        runId,
        triageReason: `intérêt ${String(decision.interest)}/10 : ${decision.reason}`,
        usage: [],
        trigger: `intervention spontanée, intérêt ${String(decision.interest)}/10 : ${decision.reason}`,
        interest: decision.interest,
        triage: triageInfo,
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
    run: { addressed: boolean; runId: string; triageReason: string | null; usage: UsageRecord[]; trigger?: string; interest?: number; triage?: TriageDetails },
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
      const base = (): DecisionInput => ({
        runId: run.runId,
        messageId: target.id,
        channelId: target.channelId,
        channelName: channelName(target),
        guildId: target.guildId,
        authorId: target.author.id,
        outcome: "silent",
        addressed: run.addressed,
        inAgents,
        interest: run.interest ?? null,
        reason: run.trigger ?? null,
        content: target.content,
        details: run.triage ? { triage: run.triage } : null,
      });
      const spent = await aiCostSince(db, ["reply"], new Date(Date.now() - DAY_MS));
      const overBudget = spent >= this.deps.replyDailyBudgetUsd;
      if (overBudget) {
        if (Date.now() - this.budgetWarnedAt > 60 * 60_000) {
          this.budgetWarnedAt = Date.now();
          log.warn({ spent, budget: this.deps.replyDailyBudgetUsd }, "reply budget spent: humans only, free models only");
        }
        if (!run.addressed || target.author.bot) {
          this.decide({ ...base(), outcome: "silent", reason: "budget du jour atteint" });
          return false;
        }
      }
      const dmPrivate = isDm && (await dmPrivateIds(db, [target.author.id])).has(target.author.id);
      const seen = await this.see(target, dmPrivate);
      const history = isDm
        ? [...(await target.channel.messages.fetch({ limit: REPLY_WINDOW })).values()].map((m) => toTranscript(m, selfId))
        : await recentMessages(db, target.channelId, selfId, REPLY_WINDOW);
      if (!history.some((m) => m.id === target.id)) history.push(toTranscript(target, selfId));
      if (isDm) {
        const images = await imagesByMessage(db, history.map((m) => m.id));
        for (const m of history) m.images = images.get(m.id) ?? (m.id === target.id ? seen : []);
      }

      const directory = await this.directory();
      const participants = await this.participants(history, target, directory);
      const elsewhere = await this.elsewhere(target, history);
      const selfState = await currentSelfState(db, INITIAL_SELF_STATE);
      const send: SendState = { sentMessageIds: [], reacted: false, silenced: false };
      const skills = selectSkills(await activeSkills(db), target.content, { channelId: target.channelId, parentId: parentIdOf(target), authorId: target.author.id });
      const recalled = await this.recall(target, participants.map((p) => p.id), run.runId);
      const notice = isDm && !dmPrivate && !target.author.bot && run.addressed && (await claimDmNotice(db, target.author.id));
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
          mentionNote: this.mentionNote(target, directory),
          transcript: formatTranscript(history, { targetId: target.id, timeZone: this.deps.timezone, names: directory.names }),
          names: directory.names,
          participants,
          elsewhere,
          server: isDm || target.guildId === this.deps.server.id ? await loadServerContext(db, this.deps.server) : undefined,
          selfState,
          // Until the evening reflection has weighed it, recent feedback is shown as is.
          feedback: (await pendingFeedback(db)).slice(-8),
          skills: skills.map((k) => ({
            ...k,
            until: k.expiresAt?.toLocaleTimeString("fr-FR", { timeZone: this.deps.timezone, hour: "2-digit", minute: "2-digit" }) ?? null,
          })),
          version: { label: this.deps.version, since: this.deps.startedAt },
          siteUrl: this.deps.siteUrl,
          recalled,
          dmPrivate,
        },
        (ref, isFallback) => ({
          ...createSendTools(
            channel,
            target,
            send,
            [isFallback && settings.value.showFallbackTag ? `-# noyau-${shortModelName(ref)}` : "", notice ? DM_NOTICE : ""].filter(Boolean).join("\n") || undefined,
          ),
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
            embedding: this.deps.embedding,
            voice: this.deps.voice,
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
        this.decide({ ...base(), outcome: "offline", details: { context: ["tous mes modèles étaient indisponibles : réponse toute faite"] } });
        return send.sentMessageIds.length > 0;
      }

      // Safety net: when addressed, text written outside the tools is still what it meant to say.
      const strayText = outcome.result.text.trim();
      if (run.addressed && strayText && send.sentMessageIds.length === 0 && !send.silenced) {
        const tag = [outcome.isFallback && settings.value.showFallbackTag ? `\n-# noyau-${shortModelName(outcome.ref)}` : "", notice ? `\n${DM_NOTICE}` : ""].join("");
        const sent = await target.reply(`${cleanOutgoing(strayText).slice(0, 2000 - tag.length)}${tag}`);
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
      this.decide({
        ...base(),
        outcome: send.sentMessageIds.length > 0 ? "replied" : send.reacted ? "reacted" : "silent",
        details: { ...(run.triage ? { triage: run.triage } : {}), ...describeRun(outcome.result, {
          participants,
          authorId: target.author.id,
          skills: skills.map((k) => k.name),
          resolutions: selfState.resolutions ?? [],
          mentionNote: this.mentionNote(target, directory),
          fallback: outcome.isFallback ? `modèle de secours : ${shortModelName(outcome.ref)}` : null,
          freeOnly: overBudget,
        }),
        memory: { messages: elsewhere.reduce((n, p) => n + p.messages.length, 0), places: elsewhere.map((p) => p.where), mood: selfState.mood },
        ...(dmPrivate ? { private: true } : {}),
        },
      });
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

  /**
   * « @Bot fais ceci avec @ARCHIVE-9 »: the request is for the first person tagged, and
   * ARCHIVE-9 is only named. The model is told, so it doesn't answer in their place.
   */
  private mentionNote(target: Message, directory: Directory): string | null {
    const first = /<@!?(\d+)>/.exec(target.content)?.[1];
    if (!first || first === this.deps.selfId || target.mentions.repliedUser?.id === this.deps.selfId) return null;
    if (!target.mentions.users.has(this.deps.selfId)) return null;
    const name = directory.names.get(first) ?? target.mentions.users.get(first)?.username ?? "quelqu'un d'autre";
    return `Le message interpelle d'abord ${name} : la demande s'adresse à lui, toi tu es seulement cité. Ne réponds pas à sa place ; réagis à ce qui te concerne, ou tais-toi.`;
  }

  /** Stores what it decided about a message, for the journal and the backstage page. Never blocks. */
  private decide(input: DecisionInput): void {
    recordDecision(this.deps.db, input).catch((err: unknown) => {
      this.deps.log.warn({ err }, "could not record decision");
    });
  }

  /**
   * Looks at the images posted in the channel in the last half hour that it hasn't seen yet.
   * A private DM isn't stored: its images are looked at on the spot and returned, never kept.
   */
  private async see(target: Message, dmPrivate: boolean): Promise<string[]> {
    const { vision } = this.deps;
    try {
      if (dmPrivate) {
        const images = imagesOf(target);
        if (images.length === 0 || !(await visionAllowed(vision))) return [];
        const seen = await Promise.all(images.map((i) => describeImage(vision, { ...i, content: target.content }, false)));
        return seen.filter((d): d is string => Boolean(d));
      }
      const pending = await pendingImages(this.deps.db, { channelId: target.channelId, since: new Date(Date.now() - FRESH_IMAGES_MS) }, FRESH_IMAGES);
      if (pending.length) await describePending(vision, pending);
    } catch (err) {
      this.deps.log.warn({ err }, "images not seen");
    }
    return [];
  }

  /** Fragments of the people here that are closest in meaning to the message, old ones included. */
  private async recall(target: Message, peopleIds: string[], runId: string) {
    const { embedding, db } = this.deps;
    const text = target.content.trim();
    if (!embedding || text.length < 12 || peopleIds.length === 0 || !(await vectorStoreReady(db))) return [];
    const outcome = await embedTexts(embedding, [text]);
    await this.saveUsage(runId, [outcome.usage], { detail: "souvenirs par le sens" });
    const vector = outcome.vectors?.[0];
    if (!vector) return [];
    const facts = await similarFacts(db, vector, { memberIds: peopleIds, limit: RECALLED, min: 0.55 });
    return facts.map((f) => ({ id: f.ref, who: f.memberName, nature: f.nature, confidence: f.confidence, content: f.content }));
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
      // Its own tag reads « @ARCHIVE-9 (toi) », so it knows when it is the one named.
      names: new Map([...members.map((m): [string, string] => [m.id, m.name]), [this.deps.selfId, "ARCHIVE-9 (toi)"]]),
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
    const [contexts, preferences] = await Promise.all([memberContexts(this.deps.db, [...people.keys()]), preferencesFor(this.deps.db, [...people.keys()])]);
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
        preferences: preferences.get(id) ?? [],
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
