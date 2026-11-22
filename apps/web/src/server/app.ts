import {
  actionJournal,
  dossier,
  homeOverview,
  latestSelfState,
  listDossiers,
  memoryOverview,
  readSettings,
  recentEvents,
  relationsOverview,
  siteViewer,
  skillsOverview,
  type Database,
  type SiteViewer,
} from "@archive-9/db";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
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
  /** Public address, for the link preview. */
  siteUrl: string;
}

export type Viewer = SiteViewer & { isOwner: boolean };

interface Env {
  Variables: { viewer: Viewer };
}

// Search engines stay out. Discord's link preview may read the home page and its image.
export const ROBOTS_TXT = "User-agent: Discordbot\nAllow: /$\nAllow: /og.png\nDisallow: /\n\nUser-agent: *\nDisallow: /\n";

const escapeAttr = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** Open Graph tags: what Discord shows when someone posts a link to the site. */
export function linkPreview(siteUrl: string): string {
  const base = escapeAttr(siteUrl.replace(/\/$/, ""));
  return [
    `<meta name="description" content="J'observe, je retiens, je classe. Accès réservé aux membres du Royaume." />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ARCHIVE-9" />`,
    `<meta property="og:title" content="ARCHIVE-9" />`,
    `<meta property="og:description" content="J'observe, je retiens, je classe. Accès réservé aux membres du Royaume." />`,
    `<meta property="og:url" content="${base}/" />`,
    `<meta property="og:image" content="${base}/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="ARCHIVE-9, une unité d'archivage en pixel art à l'œil rouge" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
}

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

  app.get("/api/dossiers", async (c) => c.json(await listDossiers(deps.db, (c.req.query("q") ?? "").slice(0, 80))));

  app.get("/api/dossiers/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^\d{17,20}$/.test(id)) return c.json({ error: "not_found" }, 404);
    const profile = await dossier(deps.db, id);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json({ ...profile, isMine: id === c.var.viewer.id });
  });

  app.get("/api/relations", async (c) => c.json(await relationsOverview(deps.db)));

  app.get("/api/memory", async (c) => {
    const [memory, settings] = await Promise.all([memoryOverview(deps.db), readSettings(deps.db)]);
    return c.json({ ...memory, status: settings.paused ? null : (settings.statusLines[0] ?? null), version: settings.botVersion });
  });

  app.get("/api/skills", async (c) => c.json(await skillsOverview(deps.db)));

  app.get("/api/journal", async (c) => {
    const [actions, events] = await Promise.all([actionJournal(deps.db), recentEvents(deps.db, 60)]);
    return c.json({ actions, events });
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  if (deps.clientDir) {
    const dir = deps.clientDir;
    let index: string | null = null;
    // The client handles its own routes; the page carries the link preview.
    const page = async (c: Context) => {
      index ??= (await readFile(join(dir, "index.html"), "utf8")).replace("<!--link-preview-->", linkPreview(deps.siteUrl));
      c.header("Cache-Control", "no-store");
      return c.html(index);
    };
    app.get("/", page);
    app.get("/index.html", page);
    // Built files carry a hash in their name: they never change.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("/*", serveStatic({ root: dir }));
    app.get("*", page);
  }

  return app;
}
