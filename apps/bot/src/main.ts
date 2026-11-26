import { AiRuntime, buildBio, createModelResolver, INITIAL_SELF_STATE } from "@archive-9/ai";
import { versionLabel } from "@archive-9/core";
import { createDb, currentSelfState, ensureServerProfile, ensureVectorStore, ensureWebRole, pendingImages, ping, runMigrations, setInGuild, syncGuildMembers, type MemberInput } from "@archive-9/db";
import type { MoodIcon } from "@archive-9/core";
import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits, type Guild, type GuildMember, type PartialGuildMember } from "discord.js";
import { COMMANDS, handleInteraction } from "./commands.ts";
import { parseEnv, routesFrom } from "./env.ts";
import { startHealthServer } from "./health.ts";
import { Ingest } from "./ingest.ts";
import { startLearningJobs } from "./learning/jobs.ts";
import { createLogger } from "./logger.ts";
import { Pipeline } from "./pipeline.ts";
import { Presence } from "./presence.ts";
import { recordRelease } from "./releases.ts";
import { startRequestWorker } from "./requests.ts";
import { SettingsStore } from "./settings.ts";
import { showFace } from "./discord/avatar.ts";
import { describePending } from "./vision.ts";
import { VoiceManager } from "./voice/session.ts";

const env = parseEnv();
const log = createLogger(env.LOG_LEVEL);
const version = versionLabel(env.GIT_SHA);
const startedAt = new Date();
log.info({ version }, "starting");

await runMigrations(env.DATABASE_URL);
log.info("migrations applied");

const { db, client: sqlClient, close: closeDb } = createDb(env.DATABASE_URL);
// The search index needs pgvector; without it, search stays by words.
const vectors = await ensureVectorStore(sqlClient).catch((err: unknown) => {
  log.warn({ err }, "vector index unavailable");
  return false;
});
log.info({ vectors }, vectors ? "vector index ready" : "no pgvector: search by words only");
const embedding = vectors ? { apiKey: env.OPENROUTER_API_KEY, model: env.EMBEDDING_MODEL } : undefined;
if (env.WEB_DB_PASSWORD) {
  await ensureWebRole(sqlClient, env.WEB_DB_PASSWORD);
  log.info("site database user ready");
}
const settings = await SettingsStore.load(db, { listenedChannelIds: env.LISTENED_CHANNEL_IDS });
await settings.set("botVersion", { label: version, startedAt: startedAt.toISOString() }, null);
const knownAiBotIds = new Set(env.KNOWN_AI_BOT_IDS);

const ai = new AiRuntime(
  routesFrom(env),
  createModelResolver({
    openrouterApiKey: env.OPENROUTER_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    openrouterProviderOrder: env.OPENROUTER_PROVIDER_ORDER,
  }),
);

const vision = { db, ai, log, dailyBudgetUsd: env.VISION_DAILY_BUDGET_USD };

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  allowedMentions: { parse: ["users"], repliedUser: true },
});

const ingest = new Ingest({ db, settings, knownAiBotIds, agentsCategoryId: env.AGENTS_CATEGORY_ID ?? null });
const presence = new Presence({ db, ai, log, settings, timezone: env.BOT_TIMEZONE, version });
const server = { id: env.DISCORD_GUILD_ID };
let pipeline: Pipeline | undefined;
let voice: VoiceManager | undefined;
let stopJobs: (() => void) | undefined;
let stopRequests: (() => void) | undefined;

const safely = (label: string, task: () => Promise<unknown>) => {
  task().catch((err: unknown) => {
    log.error({ err }, label);
  });
};

discord.once(Events.ClientReady, (client) => {
  voice = env.PIPER_URL
    ? new VoiceManager({ db, ai, log, selfId: client.user.id, timezone: env.BOT_TIMEZONE, hearing: { groqApiKey: env.GROQ_API_KEY }, piperUrl: env.PIPER_URL, dailyBudgetUsd: env.VOICE_DAILY_BUDGET_USD, version })
    : undefined;
  pipeline = new Pipeline({
    db,
    ai,
    settings,
    log,
    selfId: client.user.id,
    knownAiBotIds,
    aliases: env.BOT_ALIASES,
    softAliases: env.BOT_SOFT_ALIASES,
    timezone: env.BOT_TIMEZONE,
    server,
    agentsCategoryId: env.AGENTS_CATEGORY_ID ?? null,
    replyDailyBudgetUsd: env.REPLY_DAILY_BUDGET_USD,
    version,
    startedAt,
    siteUrl: env.SITE_URL ?? null,
    vision,
    embedding,
    voice,
  });
  presence.start(client);
  safely("bio", async () => {
    const bio = buildBio(version, env.SITE_URL);
    const application = await client.application.fetch();
    if (application.description === bio) return;
    await client.application.edit({ description: bio });
    log.info("bio updated");
  });
  const face = async (icon: MoodIcon) => {
    if (settings.value.avatarFace === icon) return;
    await showFace(client.user, icon);
    await settings.set("avatarFace", icon, null);
    log.info({ face: icon }, "avatar and banner updated");
  };
  const learning = {
    db,
    client: sqlClient,
    ai,
    log,
    selfId: client.user.id,
    timezone: env.BOT_TIMEZONE,
    channelName: (id: string) => {
      const channel = client.channels.cache.get(id);
      return channel && "name" in channel ? channel.name : null;
    },
    server,
    tidyDryRun: () => settings.value.tidyDryRun,
    seeImages: async (messageIds: string[]) => {
      await describePending(vision, await pendingImages(db, { messageIds }, 40));
    },
    onFace: face,
  };
  // The face on Discord follows the current mood, from the start.
  safely("avatar", async () => {
    const icon = (await currentSelfState(db, INITIAL_SELF_STATE)).icon;
    if (icon) await face(icon);
  });
  stopJobs ??= startLearningJobs(learning, {
    analysisDailyBudgetUsd: env.ANALYSIS_DAILY_BUDGET_USD,
    reflectionHours: () => settings.value.reflectionHours,
    retentionDays: env.MESSAGE_RETENTION_DAYS,
    embedding,
  });
  stopRequests ??= startRequestWorker({ ...learning, settings });
  safely("release", () => recordRelease({ db, ai, log, repo: env.GITHUB_REPO, sha: env.GIT_SHA }));
  safely("command registration", async () => {
    await registerCommands(await client.guilds.fetch(env.DISCORD_GUILD_ID));
  });
  log.info({ user: client.user.tag, listened: settings.value.listenedChannelIds.length }, "connected to Discord");
});

/** Guild commands disappear when the bot is removed: they are sent again when it comes back. */
async function registerCommands(guild: Guild) {
  await ensureServerProfile(db, guild.id, guild.name);
  await guild.commands.set(COMMANDS);
  log.info({ count: COMMANDS.length }, "commands registered");
  await publishChannels(guild);
  const all = await guild.members.fetch();
  await syncGuildMembers(db, [...all.values()].map((m) => memberInput(m)));
  log.info({ count: all.size }, "guild members synced");
}

/** The site names channels from this list; it has no access to Discord. */
async function publishChannels(guild: Guild) {
  const channels = await guild.channels.fetch();
  const list = [...channels.values()]
    .filter((c) => c?.isTextBased() && !c.isThread())
    .map((c) => ({
      id: c?.id ?? "",
      name: c?.name ?? "",
      category: c?.parent?.name ?? null,
      // Only public channels show their messages on the site.
      isPublic: c ? c.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.ViewChannel) : false,
    }));
  await settings.set("channelDirectory", list, null);
}

// Settings changed from the site reach the running bot within 30 seconds.
setInterval(() => {
  void settings.reload().then(() => {
    presence.show();
  });
}, 30_000);

function memberInput(m: GuildMember | PartialGuildMember): MemberInput {
  return { id: m.id, username: m.user.username, displayName: m.displayName, isBot: m.user.bot, isKnownAiBot: knownAiBotIds.has(m.id), avatar: m.user.avatar };
}

// Who is on the server decides who may open the site.
discord.on(Events.GuildMemberAdd, (m) => {
  if (m.guild.id === env.DISCORD_GUILD_ID) safely("member add", () => setInGuild(db, memberInput(m), true));
});
discord.on(Events.GuildMemberRemove, (m) => {
  if (m.guild.id === env.DISCORD_GUILD_ID) safely("member remove", () => setInGuild(db, memberInput(m), false));
});

// Left alone in the voice channel: it goes too.
discord.on(Events.VoiceStateUpdate, () => {
  voice?.checkAlone();
});

discord.on(Events.GuildCreate, (guild) => {
  if (guild.id === env.DISCORD_GUILD_ID) safely("command registration", () => registerCommands(guild));
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
  safely("interaction", () => handleInteraction(interaction, { db, settings, log, selfId: discord.user?.id ?? "", guildId: env.DISCORD_GUILD_ID, agentsCategoryId: env.AGENTS_CATEGORY_ID ?? null, version, presence }));
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
  voice?.stop();
  presence.stop();
  stopJobs?.();
  stopRequests?.();
  health.close();
  await discord.destroy();
  await closeDb();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
