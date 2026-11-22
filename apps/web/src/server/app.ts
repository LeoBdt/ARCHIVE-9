import { checkOwnFactText } from "@archive-9/core";
import {
  accessList,
  actionJournal,
  backstage,
  correctOwnFact,
  dossier,
  forgetOwnFacts,
  grantSiteAdmin,
  replyJournal,
  revokeSiteAdmin,
  rollbackSelfState,
  saveSetting,
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
import { z } from "zod";
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

  // Writes only from the site itself: a page elsewhere can't post in a member's name.
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("origin") !== new URL(deps.siteUrl).origin) return c.json({ error: "bad_origin" }, 403);
    await next();
  });

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
    const [replies, actions, events] = await Promise.all([replyJournal(deps.db, c.var.viewer), actionJournal(deps.db), recentEvents(deps.db, 60)]);
    return c.json({ replies, actions, events });
  });

  app.get("/api/coulisses", async (c) => {
    const [data, settings] = await Promise.all([backstage(deps.db), readSettings(deps.db)]);
    return c.json({ ...data, paused: settings.paused });
  });

  // A member's own facts: correct or remove, with a reason the bot learns from.
  const factChange = z.discriminatedUnion("action", [
    z.object({ action: z.literal("correct"), content: z.string(), reason: z.string().max(300).default("") }),
    z.object({ action: z.literal("remove"), reason: z.string().trim().min(3).max(300) }),
  ]);
  app.post("/api/me/facts/:id", async (c) => {
    const body = factChange.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const viewer = c.var.viewer;
    const id = c.req.param("id");
    if (body.data.action === "remove") {
      const removed = await forgetOwnFacts(deps.db, viewer.id, [id], body.data.reason, "site");
      return removed.length ? c.json({ ok: true }) : c.json({ error: "not_yours" }, 404);
    }
    const problem = checkOwnFactText(body.data.content);
    if (problem) return c.json({ error: problem }, 400);
    const changed = await correctOwnFact(deps.db, viewer.id, id, body.data.content.trim(), body.data.reason.trim(), "site");
    return changed ? c.json({ ok: true, ...changed }) : c.json({ error: "not_yours" }, 404);
  });

  // Settings: admins only. The bot picks changes up within 30 seconds.
  app.get("/api/settings", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const s = await readSettings(deps.db);
    return c.json({ paused: s.paused, spontaneity: s.spontaneity, showFallbackTag: s.showFallbackTag, listenedChannelIds: s.listenedChannelIds, channels: s.channelDirectory });
  });
  const settingsChange = z.object({
    paused: z.boolean().optional(),
    spontaneity: z.number().int().min(0).max(3).optional(),
    showFallbackTag: z.boolean().optional(),
    listenedChannelIds: z.array(z.string().regex(/^\d{17,20}$/)).max(200).optional(),
  });
  app.post("/api/settings", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = settingsChange.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const by = c.var.viewer.id;
    // Absent fields stay as they are: zod leaves them out of the parsed object.
    for (const [key, value] of Object.entries(body.data)) await saveSetting(deps.db, key as keyof typeof body.data, value as never, by);
    return c.json({ ok: true });
  });

  app.post("/api/memory/rollback", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = z.object({ version: z.number().int().positive() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const version = await rollbackSelfState(deps.db, body.data.version, c.var.viewer.id);
    return version ? c.json({ ok: true, version }) : c.json({ error: "not_found" }, 404);
  });

  // Who is admin: the owner only.
  app.get("/api/access", async (c) => {
    if (!c.var.viewer.isOwner) return c.json({ error: "forbidden" }, 403);
    return c.json((await accessList(deps.db)).map((m) => ({ ...m, isOwner: m.id === deps.ownerId })));
  });
  app.post("/api/access", async (c) => {
    if (!c.var.viewer.isOwner) return c.json({ error: "forbidden" }, 403);
    const body = z.object({ memberId: z.string().regex(/^\d{17,20}$/), admin: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success || body.data.memberId === deps.ownerId) return c.json({ error: "invalid" }, 400);
    await (body.data.admin ? grantSiteAdmin(deps.db, body.data.memberId, c.var.viewer.id) : revokeSiteAdmin(deps.db, body.data.memberId));
    return c.json({ ok: true });
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
