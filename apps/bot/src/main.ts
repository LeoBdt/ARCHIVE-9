import { createDb, ping, runMigrations } from "@archive-9/db";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { parseEnv } from "./env.ts";
import { startHealthServer } from "./health.ts";
import { createLogger } from "./logger.ts";

const env = parseEnv();
const log = createLogger(env.LOG_LEVEL);

await runMigrations(env.DATABASE_URL);
log.info("migrations applied");

const { db, close: closeDb } = createDb(env.DATABASE_URL);

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

discord.once(Events.ClientReady, (client) => {
  log.info({ user: client.user.tag }, "connected to Discord");
});

const health = startHealthServer(env.HEALTH_PORT, async () => {
  if (!discord.isReady()) return false;
  await ping(db);
  return true;
});

await discord.login(env.DISCORD_TOKEN);

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  health.close();
  await discord.destroy();
  await closeDb();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
