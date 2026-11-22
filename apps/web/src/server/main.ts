import { createDb } from "@archive-9/db";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { parseWebEnv } from "./env.ts";

const env = parseWebEnv();
const log = pino({ level: env.LOG_LEVEL, base: { service: "web" } });
const { db, close } = createDb(env.DATABASE_URL, { max: 5 });
const auth = createAuth(db, env);

const app = createApp({
  db,
  ownerId: env.SITE_OWNER_ID,
  siteUrl: env.SITE_URL,
  clientDir: env.NODE_ENV === "production" ? fileURLToPath(new URL("../../dist/client", import.meta.url)) : null,
  auth: {
    handler: (request) => auth.handler(request),
    discordId: async (headers) => {
      const session = await auth.api.getSession({ headers });
      // Declared in `user.additionalFields`, which the session type doesn't carry.
      return (session?.user as { discordId?: string } | undefined)?.discordId ?? null;
    },
  },
});

app.onError((error, c) => {
  log.error({ err: error, path: c.req.path }, "request failed");
  return c.json({ error: "internal" }, 500);
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info({ port: info.port }, "site listening");
});

function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  server.close();
  void close().finally(() => process.exit(0));
}
process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  shutdown("SIGINT");
});
