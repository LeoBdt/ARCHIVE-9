import { homeOverview, latestSelfState, readSettings, siteViewer, type Database, type SiteViewer } from "@archive-9/db";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** What the app needs from Better Auth, so tests can stand in for it. */
export interface AuthPort {
  handler: (request: Request) => Promise<Response>;
  /** Discord ID of the signed-in person, or null. */
  discordId: (headers: Headers) => Promise<string | null>;
}

export interface AppDeps {
  db: Database;
  auth: AuthPort;
  ownerId: string;
  /** Built client (Vite output), or null to serve the API only. */
  clientDir: string | null;
}

export type Viewer = SiteViewer & { isOwner: boolean };

interface Env {
  Variables: { viewer: Viewer };
}

export const ROBOTS_TXT = "User-agent: *\nDisallow: /\n";

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      referrerPolicy: "same-origin",
      xFrameOptions: "DENY",
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    }),
  );
  // Nothing on this site is meant for a search engine.
  app.use(async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  });

  app.get("/robots.txt", (c) => c.text(ROBOTS_TXT));
  app.get("/health", (c) => c.text("ok"));

  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  // Every other API call needs a session of someone who is on the server right now.
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const discordId = await deps.auth.discordId(c.req.raw.headers);
    if (!discordId) return c.json({ error: "unauthenticated" }, 401);
    const viewer = await siteViewer(deps.db, discordId);
    if (!viewer?.inGuild) return c.json({ error: "not_in_guild" }, 403);
    const isOwner = viewer.id === deps.ownerId;
    c.set("viewer", { ...viewer, isOwner, isAdmin: isOwner || viewer.isAdmin });
    await next();
  });

  app.get("/api/me", (c) => c.json(c.var.viewer));

  app.get("/api/home", async (c) => {
    const [overview, settings, self] = await Promise.all([homeOverview(deps.db), readSettings(deps.db), latestSelfState(deps.db)]);
    return c.json({
      ...overview,
      mood: self?.mood ?? null,
      status: settings.paused ? null : (settings.statusLines[0] ?? null),
      paused: settings.paused,
      version: settings.botVersion,
    });
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  if (deps.clientDir) {
    const dir = deps.clientDir;
    // Built files carry a hash in their name: they never change.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("/*", serveStatic({ root: dir }));
    let index: string | null = null;
    // The client handles its own routes.
    app.get("*", async (c) => {
      index ??= await readFile(join(dir, "index.html"), "utf8");
      c.header("Cache-Control", "no-store");
      return c.html(index);
    });
  }

  return app;
}
