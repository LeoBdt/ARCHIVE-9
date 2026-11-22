import { AiRuntime, createModelResolver } from "@archive-9/ai";
import { createDb, ping, runMigrations } from "@archive-9/db";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { COMMANDS, handleInteraction } from "./commands.ts";
import { parseEnv } from "./env.ts";
import { startHealthServer } from "./health.ts";
import { Ingest } from "./ingest.ts";
import { createLogger } from "./logger.ts";
import { Pipeline } from "./pipeline.ts";
import { SettingsStore } from "./settings.ts";

const env = parseEnv();
const log = createLogger(env.LOG_LEVEL);

await runMigrations(env.DATABASE_URL);
log.info("migrations applied");

const { db, close: closeDb } = createDb(env.DATABASE_URL);
const settings = await SettingsStore.load(db, { listenedChannelIds: env.LISTENED_CHANNEL_IDS });
const knownAiBotIds = new Set(env.KNOWN_AI_BOT_IDS);

const ai = new AiRuntime(
  {
    triage: env.AI_ROUTE_TRIAGE,
    reply: env.AI_ROUTE_REPLY,
    analysis: env.AI_ROUTE_ANALYSIS,
    reflection: env.AI_ROUTE_REFLECTION,
  },
  createModelResolver({
    openrouterApiKey: env.OPENROUTER_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    openrouterProviderOrder: env.OPENROUTER_PROVIDER_ORDER,
  }),
);

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  allowedMentions: { parse: ["users"], repliedUser: true },
});

const ingest = new Ingest({ db, settings, knownAiBotIds });
let pipeline: Pipeline | undefined;

const safely = (label: string, task: () => Promise<unknown>) => {
  task().catch((err: unknown) => {
    log.error({ err }, label);
  });
};

discord.once(Events.ClientReady, (client) => {
  pipeline = new Pipeline({
    db,
    ai,
    settings,
    log,
    selfId: client.user.id,
    knownAiBotIds,
    aliases: env.BOT_ALIASES,
    timezone: env.BOT_TIMEZONE,
  });
  safely("command registration", async () => {
    const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
    await guild.commands.set(COMMANDS);
    log.info({ count: COMMANDS.length }, "commands registered");
  });
  log.info({ user: client.user.tag, listened: settings.value.listenedChannelIds.length }, "connected to Discord");
});

discord.on(Events.MessageCreate, (message) => {
  safely("message", async () => {
    await ingest.onCreate(message);
    await pipeline?.handle(message);
  });
});
discord.on(Events.MessageUpdate, (_old, message) => {
  safely("message update", () => ingest.onUpdate(message));
});
discord.on(Events.MessageDelete, (message) => {
  safely("message delete", () => ingest.onDelete([message.id]));
});
discord.on(Events.MessageBulkDelete, (messages) => {
  safely("bulk delete", () => ingest.onDelete([...messages.keys()]));
});
discord.on(Events.MessageReactionAdd, (reaction) => {
  safely("reaction", () => ingest.onReaction(reaction));
});
discord.on(Events.MessageReactionRemove, (reaction) => {
  safely("reaction", () => ingest.onReaction(reaction));
});
discord.on(Events.InteractionCreate, (interaction) => {
  if (!discord.user) return;
  safely("interaction", () => handleInteraction(interaction, { db, settings, log, selfId: discord.user?.id ?? "" }));
});

const health = startHealthServer(env.HEALTH_PORT, async () => {
  if (!discord.isReady()) return false;
  await ping(db);
  return true;
});

await discord.login(env.DISCORD_TOKEN);

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  pipeline?.stop();
  health.close();
  await discord.destroy();
  await closeDb();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
