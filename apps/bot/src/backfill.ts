/**
 * Reads the history of the listened channels from Discord and analyses it.
 *
 *   node src/backfill.ts --days 30 --dry-run
 *   node src/backfill.ts --days 30 --max-cost 0.5 [--channel <id>] [--reflect | --server]
 */
import { parseArgs } from "node:util";
import { AiRuntime, createModelResolver } from "@archive-9/ai";
import type { MessageReactions } from "@archive-9/core";
import {
  createDb,
  ensureMember,
  ensureServerProfile,
  existingMessageIds,
  insertMessages,
  loadSettings,
  markAnalysed,
  optedOutIds,
  pendingMessages,
  withAdvisoryLock,
  type MessageInput,
} from "@archive-9/db";
import {
  MessageFlags,
  MessageType,
  REST,
  Routes,
  type APIChannel,
  type APIMessage,
  type APIUser,
  type RESTGetAPIGuildThreadsResult,
} from "discord.js";
import { parseEnv } from "./env.ts";
import { runAnalysis } from "./learning/analyse.ts";
import { runAwakening } from "./learning/reflect.ts";
import { estimateAnalysisCost } from "./learning/estimate.ts";
import { ANALYSIS_LOCK } from "./learning/jobs.ts";
import { createLogger } from "./logger.ts";

const { values: args } = parseArgs({
  options: {
    days: { type: "string", default: "30" },
    "dry-run": { type: "boolean", default: false },
    "max-cost": { type: "string" },
    channel: { type: "string" },
    reflect: { type: "boolean", default: false },
    server: { type: "boolean", default: false },
  },
});

const env = parseEnv();
const log = createLogger("warn");
const days = Math.min(Number(args.days), env.MESSAGE_RETENTION_DAYS);
const maxCost = args["max-cost"] === undefined ? null : Number(args["max-cost"]);
if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");
if (!args["dry-run"] && (maxCost === null || !Number.isFinite(maxCost) || maxCost <= 0)) {
  throw new Error("--max-cost <usd> is required, or use --dry-run first");
}

const since = new Date(Date.now() - days * 24 * 60 * 60_000);
const rest = new REST().setToken(env.DISCORD_TOKEN);
const { db, client, close } = createDb(env.DATABASE_URL, { max: 3 });

async function listChannels(listened: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of listened) {
    try {
      const channel = (await rest.get(Routes.channel(id))) as APIChannel;
      names.set(id, "name" in channel && channel.name ? channel.name : id);
    } catch {
      console.warn(`  channel ${id}: not reachable, skipped`);
    }
  }
  const { threads } = (await rest.get(Routes.guildActiveThreads(env.DISCORD_GUILD_ID))) as RESTGetAPIGuildThreadsResult;
  for (const thread of threads) {
    const parentId = (thread as { parent_id?: string | null }).parent_id;
    if (parentId && listened.includes(parentId) && "name" in thread) names.set(thread.id, thread.name ?? thread.id);
  }
  return names;
}

async function fetchHistory(channelId: string): Promise<APIMessage[]> {
  const result: APIMessage[] = [];
  let before: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const page = (await rest.get(Routes.channelMessages(channelId), { query })) as APIMessage[];
    for (const message of page) {
      if (new Date(message.timestamp) < since) return result;
      result.push(message);
    }
    if (page.length < 100) return result;
    before = page.at(-1)?.id;
  }
}

function isArchivable(message: APIMessage): boolean {
  if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return false;
  // Same rule as live ingestion: command answers are system text.
  return !message.interaction_metadata && ((message.flags ?? 0) & MessageFlags.Ephemeral) === 0;
}

function reactionsOf(message: APIMessage): MessageReactions {
  const counts: MessageReactions = {};
  for (const r of message.reactions ?? []) {
    counts[r.emoji.id ? `<:${r.emoji.name ?? "emoji"}:${r.emoji.id}>` : (r.emoji.name ?? "?")] = r.count;
  }
  return counts;
}

const self = (await rest.get(Routes.user())) as APIUser;
const settings = await loadSettings(db);
const listened = args.channel ? [args.channel] : settings.listenedChannelIds;
if (listened.length === 0) throw new Error("No listened channel: use /config ecoute first");

console.log(`Reading ${String(days)} days of history…`);
const channels = await listChannels(listened);
const messages: APIMessage[] = [];
for (const [id, name] of channels) {
  try {
    const history = (await fetchHistory(id)).filter(isArchivable);
    console.log(`  #${name}: ${String(history.length)} messages`);
    for (const message of history) messages.push({ ...message, channel_id: id });
  } catch {
    console.warn(`  #${name}: no access, skipped`);
  }
}

const optedOut = await optedOutIds(db, [...new Set(messages.map((m) => m.author.id))]);
const kept = messages.filter((m) => !optedOut.has(m.author.id));
const known = await existingMessageIds(db, kept.map((m) => m.id));
const fresh = kept.filter((m) => !known.has(m.id));
const authors = new Set(fresh.map((m) => m.author.id));
const estimate = estimateAnalysisCost(fresh.length, fresh.reduce((sum, m) => sum + m.content.length, 0), authors.size);

console.log(`
${String(kept.length)} messages found, ${String(known.size)} already archived, ${String(fresh.length)} new, from ${String(authors.size)} members.
Estimate: ~${String(estimate.batches)} batches, ~${String(Math.round(estimate.inputTokens / 1000))}k tokens in, ~${String(Math.round(estimate.outputTokens / 1000))}k out.
Cost: $${estimate.lowUsd.toFixed(2)} to $${estimate.highUsd.toFixed(2)}, plus messages already waiting for analysis${args.reflect || args.server ? ", plus ~$0.01 for the history reading" : ""}.
Expect roughly ${String(Math.ceil((estimate.batches * 30 + authors.size * 5) / 60))} minutes; run it in tmux or screen.`);

if (args["dry-run"] || maxCost === null) {
  await close();
  process.exit(0);
}

const ai = new AiRuntime(
  { triage: env.AI_ROUTE_TRIAGE, reply: env.AI_ROUTE_REPLY, analysis: env.AI_ROUTE_ANALYSIS, reflection: env.AI_ROUTE_REFLECTION },
  createModelResolver({
    openrouterApiKey: env.OPENROUTER_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    openrouterProviderOrder: env.OPENROUTER_PROVIDER_ORDER,
  }),
);
const knownAiBots = new Set(env.KNOWN_AI_BOT_IDS);

const lock = await withAdvisoryLock(client, ANALYSIS_LOCK, async () => {
  for (const author of new Map(fresh.map((m) => [m.author.id, m.author])).values()) {
    await ensureMember(db, {
      id: author.id,
      username: author.username,
      displayName: author.global_name ?? null,
      isBot: author.bot ?? false,
      isKnownAiBot: knownAiBots.has(author.id),
    });
  }
  const inserted = await insertMessages(
    db,
    fresh.map(
      (m): MessageInput => ({
        id: m.id,
        guildId: env.DISCORD_GUILD_ID,
        channelId: m.channel_id,
        authorId: m.author.id,
        content: m.content,
        replyToId: m.message_reference?.message_id ?? null,
        mentionedIds: m.mentions.map((user) => user.id),
        createdAt: new Date(m.timestamp),
        reactions: reactionsOf(m),
      }),
    ),
  );
  console.log(`\n${String(inserted.length)} messages archived. Analysing (max $${maxCost.toFixed(2)})…`);

  const guild = (await rest.get(Routes.guild(env.DISCORD_GUILD_ID))) as { id: string; name: string };
  await ensureServerProfile(db, guild.id, guild.name);
  const deps = {
    db,
    ai,
    log,
    selfId: self.id,
    timezone: env.BOT_TIMEZONE,
    channelName: (id: string) => channels.get(id) ?? null,
    server: { id: guild.id },
  };
  const report = await runAnalysis(
    deps,
    {
      budgetUsd: maxCost,
      includeOngoing: true,
      onBatch: ({ messages: done, costUsd }) => {
        console.log(`  ${String(done)} messages analysed, $${costUsd.toFixed(4)}`);
      },
    },
  );

  if (report.budgetReached) {
    // The cap was explicit: what is left of the history is skipped, not handed to the bot.
    const insertedIds = new Set(inserted);
    const left = (await pendingMessages(db, self.id, new Date(), 100_000)).filter((m) => insertedIds.has(m.id)).map((m) => m.id);
    await markAnalysed(db, left);
    console.log(`Budget reached: ${String(left.length)} old messages kept but not analysed.`);
  }
  if (report.failed) console.log("A batch failed; the remaining messages stay pending and the bot will analyse them later.");
  console.log(`Done: ${String(report.messages)} messages, ${String(report.facts)} facts, ${String(report.summaries)} profiles, $${report.costUsd.toFixed(4)}.`);

  if (args.reflect || args.server) {
    console.log(args.reflect ? "Reading the whole history to build ARCHIVE-9's first self state…" : "Reading the whole history for the server's profile…");
    try {
      if (await runAwakening(deps, since, { serverOnly: !args.reflect })) console.log("Done reading.");
    } catch (error) {
      console.log(`Reflection failed: ${(error as Error).message}`);
    }
  }
});

if (!lock.acquired) console.log("The bot is analysing right now. Try again in a few minutes.");
await close();
process.exit(0);
