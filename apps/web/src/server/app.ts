import { checkOwnFactText, isEmptySearch, parseSearchQuery } from "@archive-9/core";
import {
  accessList,
  actionJournal,
  answerNote,
  applyPlannedOperation,
  dismissPlannedOperation,
  factOperationLog,
  feedbackHistory,
  notebook,
  searchArchives,
  storageStats,
  technicalDrawers,
  closeSkill,
  correctOwnFact,
  createSiteRequest,
  dossier,
  errorJournal,
  factOwner,
  forgetOwnFacts,
  getSiteRequest,
  getSkill,
  grantSiteAdmin,
  homeOverview,
  learnedJournal,
  listDossiers,
  memoryOverview,
  messageContext,
  namesFor,
  readSettings,
  relationsOverview,
  replyJournal,
  revokeSiteAdmin,
  rollbackSelfState,
  saveSetting,
  siteViewer,
  skillHistory,
  skillsOverview,
  systemOverview,
  triageJournal,
  type Database,
  type RequestKind,
  type SiteViewer,
} from "@archive-9/db";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Live } from "./live.ts";
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
  /** Change notifications from the database; without it, pages just poll. */
  live?: Live;
  /** The bot's daily reply budget, shown on the system page. */
  replyBudgetUsd?: number;
}

const HEARTBEAT_MS = 25_000;

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
        // Profile pictures come from Discord's CDN.
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
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

  // Open pages learn right away that something changed. Only the kind of change is sent,
  // never content, so nobody learns more here than the API would show them.
  app.get("/api/live", (c) => {
    const live = deps.live;
    if (!live) return c.json({ error: "unavailable" }, 503);
    return streamSSE(c, async (stream) => {
      const unsubscribe = live.subscribe((type) => {
        void stream.writeSSE({ event: "change", data: type });
      });
      stream.onAbort(() => {
        unsubscribe();
      });
      await stream.writeSSE({ event: "ready", data: "" });
      // A quiet stream would be cut by the tunnel: say something every 25 s.
      for (;;) {
        await stream.sleep(HEARTBEAT_MS);
        if (stream.aborted) break;
        await stream.writeSSE({ event: "ping", data: "" });
      }
      unsubscribe();
    });
  });

  /** Public channels and channel names, as the bot published them. */
  const channels = async () => {
    const list = (await readSettings(deps.db)).channelDirectory;
    return { names: new Map(list.map((ch) => [ch.id, ch.name])), open: new Set(list.filter((ch) => ch.isPublic === true).map((ch) => ch.id)) };
  };

  /** `<@123>` becomes `@Tom` and `<#456>` `#général`, in every text the journal shows. */
  const readable = async <T>(value: T): Promise<T> => {
    const raw = JSON.stringify(value);
    const ids = [...new Set([...raw.matchAll(/<@!?(\d{17,20})>/g)].map((m) => m[1] ?? ""))];
    const [names, { names: channelNames }] = await Promise.all([namesFor(deps.db, ids), channels()]);
    const swapped = raw
      .replace(/<@!?(\d{17,20})>/g, (tag, id: string) => (names.has(id) ? `@${(names.get(id) ?? "").replaceAll('"', "'")}` : tag))
      .replace(/<#(\d{17,20})>/g, (tag, id: string) => (channelNames.has(id) ? `#${channelNames.get(id) ?? ""}` : tag));
    return JSON.parse(swapped) as T;
  };

  app.get("/api/home", async (c) => {
    const [overview, settings, history] = await Promise.all([homeOverview(deps.db), readSettings(deps.db), memoryOverview(deps.db, 1)]);
    const last = history.history[0];
    return c.json({
      ...overview,
      feed: await readable(overview.feed),
      mood: last?.state.mood ?? null,
      icon: last?.state.icon ?? null,
      moodAt: last?.createdAt ?? null,
      moodSource: last?.source ?? null,
      status: settings.paused ? null : (settings.statusLines[0] ?? null),
      statusAt: settings.statusAt,
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
    return c.json({ ...profile, isMine: id === c.var.viewer.id, canEdit: id === c.var.viewer.id || c.var.viewer.isAdmin });
  });

  // The archived message behind a fragment or an event, read on the site first.
  app.get("/api/messages/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^\d{17,20}$/.test(id)) return c.json({ error: "not_found" }, 404);
    const { names, open } = await channels();
    return c.json(await readable(await messageContext(deps.db, id, c.var.viewer.id, open, names)));
  });

  app.get("/api/relations", async (c) => c.json(await relationsOverview(deps.db)));

  // The search engine: words, people, fragment IDs and ranks, drawers, dates.
  app.get("/api/search", async (c) => {
    const q = parseSearchQuery(c.req.query("q") ?? "");
    if (isEmptySearch(q)) return c.json({ empty: true });
    const { names, open } = await channels();
    const started = Date.now();
    const results = await searchArchives(deps.db, q, c.var.viewer, { publicChannelIds: [...open], limit: 30 });
    return c.json(
      await readable({
        ...results,
        messages: results.messages.map((m) => ({ ...m, channelName: m.guildId === null ? null : (names.get(m.channelId) ?? null), isDm: m.guildId === null })),
        tookMs: Date.now() - started,
        query: { ...q, after: q.after?.toISOString() ?? null, before: q.before?.toISOString() ?? null },
      }),
    );
  });

  // Technique: admins only. Feedback history, what the tidy did, its notebook, storage.
  app.get("/api/technique", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const [feedback, operations, notes, storage, drawers, settings] = await Promise.all([
      feedbackHistory(deps.db),
      factOperationLog(deps.db, { limit: 300 }),
      notebook(deps.db),
      storageStats(deps.db),
      technicalDrawers(deps.db),
      readSettings(deps.db),
    ]);
    return c.json(await readable({ feedback, operations, notes, storage, drawers, tidyDryRun: settings.tidyDryRun, isOwner: c.var.viewer.isOwner }));
  });
  app.post("/api/technique/operations/:id", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = z.object({ action: z.enum(["apply", "dismiss"]) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const id = c.req.param("id");
    if (body.data.action === "dismiss") return (await dismissPlannedOperation(deps.db, id, c.var.viewer.id)) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
    const status = await applyPlannedOperation(deps.db, id, c.var.viewer.id);
    return status === "not_found" ? c.json({ error: "not_found" }, 404) : c.json({ ok: true, status });
  });
  // Its notebook is addressed to its creator: the owner answers.
  app.post("/api/technique/notes/:id", async (c) => {
    if (!c.var.viewer.isOwner) return c.json({ error: "forbidden" }, 403);
    const body = z.object({ status: z.enum(["open", "done", "declined", "later"]), answer: z.string().max(500).default("") }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    return (await answerNote(deps.db, c.req.param("id"), body.data.status, body.data.answer, c.var.viewer.id)) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });
  app.post("/api/technique/cleanup", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    return queue(c, "cleanup", null, { by: c.var.viewer.name }, "Grand ménage demandé.");
  });

  app.get("/api/esprit", async (c) => {
    const [memory, settings] = await Promise.all([memoryOverview(deps.db), readSettings(deps.db)]);
    return c.json({
      ...(await readable(memory)),
      status: settings.paused ? null : (settings.statusLines[0] ?? null),
      version: settings.botVersion,
      reflectionHours: settings.reflectionHours,
      paused: settings.paused,
    });
  });

  app.post("/api/esprit/rollback", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = z.object({ version: z.number().int().positive() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const version = await rollbackSelfState(deps.db, body.data.version, c.var.viewer.id);
    return version ? c.json({ ok: true, version }) : c.json({ error: "not_found" }, 404);
  });

  /** Queues something for ARCHIVE-9 and gives its ID, so the page follows each step. */
  const queue = async (c: Context<Env>, kind: RequestKind, targetId: string | null, payload: Record<string, unknown>, firstStep: string) => {
    const id = await createSiteRequest(deps.db, { kind, requesterId: c.var.viewer.id, targetId, payload, firstStep });
    return id ? c.json({ ok: true, requestId: id }) : c.json({ error: "too_many" }, 429);
  };

  // Comments on its mind: admins only. It answers, and weighs them in the evening.
  app.post("/api/esprit/comment", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const body = z.object({ about: z.string().trim().min(1).max(300), comment: z.string().trim().min(3).max(600) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    return queue(c, "mind_comment", null, { ...body.data, authorName: c.var.viewer.name }, `Commentaire de ${c.var.viewer.name} reçu.`);
  });

  app.get("/api/requests/:id", async (c) => {
    const request = await getSiteRequest(deps.db, c.req.param("id"));
    if (!request || (request.requesterId !== c.var.viewer.id && !c.var.viewer.isAdmin)) return c.json({ error: "not_found" }, 404);
    return c.json({ id: request.id, kind: request.kind, status: request.status, steps: request.steps, result: request.result, createdAt: request.createdAt, finishedAt: request.finishedAt });
  });

  app.get("/api/skills", async (c) => {
    const { names } = await channels();
    const viewer = c.var.viewer;
    const list = await skillsOverview(deps.db);
    return c.json(list.map((k) => ({ ...k, channelName: k.channelId ? (names.get(k.channelId) ?? null) : null, canEdit: viewer.isAdmin || k.authorId === viewer.id })));
  });

  app.get("/api/skills/:id/history", async (c) => c.json(await skillHistory(deps.db, c.req.param("id"))));

  const skillText = z.object({ text: z.string().trim().min(5).max(600) });
  app.post("/api/skills", async (c) => {
    const body = skillText.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    return queue(c, "skill_create", null, body.data, "Reçu.");
  });

  app.post("/api/skills/:id", async (c) => {
    const body = skillText.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const skill = await getSkill(deps.db, c.req.param("id"));
    if (!skill) return c.json({ error: "not_found" }, 404);
    if (skill.authorId !== c.var.viewer.id && !c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    return queue(c, "skill_edit", skill.id, { ...body.data, skillId: skill.id }, `Modification de « ${skill.name} » reçue.`);
  });

  app.post("/api/skills/:id/delete", async (c) => {
    const result = await closeSkill(deps.db, c.req.param("id"), c.var.viewer.id, c.var.viewer.isAdmin);
    return result === "ok" ? c.json({ ok: true }) : c.json({ error: result }, result === "forbidden" ? 403 : 404);
  });

  app.get("/api/journal/:tab", async (c) => {
    const viewer = c.var.viewer;
    switch (c.req.param("tab")) {
      case "replies":
        return c.json(await readable(await replyJournal(deps.db, viewer)));
      case "learned": {
        const { names, open } = await channels();
        return c.json(await readable(await learnedJournal(deps.db, open, names)));
      }
      case "actions":
        return c.json(await actionJournal(deps.db));
      case "triage":
        return c.json(await readable(await triageJournal(deps.db, viewer)));
      case "errors":
        return c.json(await errorJournal(deps.db));
      default:
        return c.json({ error: "not_found" }, 404);
    }
  });

  app.get("/api/systeme", async (c) => {
    const [data, settings] = await Promise.all([systemOverview(deps.db), readSettings(deps.db)]);
    return c.json({ ...data, replyBudgetUsd: deps.replyBudgetUsd ?? 1, paused: settings.paused, version: settings.botVersion });
  });

  // Facts: a member edits their own; an admin may edit anyone's. The change is saved at
  // once, then ARCHIVE-9 reads the rest of the dossier and says what it understood.
  const factChange = z.discriminatedUnion("action", [
    z.object({ action: z.literal("correct"), content: z.string(), reason: z.string().max(300).default("") }),
    z.object({ action: z.literal("remove"), reason: z.string().trim().min(3).max(300) }),
  ]);
  app.post("/api/facts/:id", async (c) => {
    const body = factChange.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const viewer = c.var.viewer;
    const id = c.req.param("id");
    const owner = await factOwner(deps.db, id);
    if (!owner || (owner !== viewer.id && !viewer.isAdmin)) return c.json({ error: "not_yours" }, 404);
    const byOwner = owner === viewer.id;
    const by = byOwner ? null : viewer.id;
    const reason = body.data.reason.trim();
    const payload = { memberId: owner, factId: id, reason, editorName: viewer.name, byOwner };
    if (body.data.action === "remove") {
      const removed = await forgetOwnFacts(deps.db, owner, [id], reason, "site", by);
      if (!removed.length) return c.json({ error: "not_found" }, 404);
      return queue(c, "fact_remove", owner, { ...payload, before: removed[0] }, "Fragment retiré, c'est enregistré.");
    }
    const problem = checkOwnFactText(body.data.content);
    if (problem) return c.json({ error: problem }, 400);
    const changed = await correctOwnFact(deps.db, owner, id, body.data.content.trim(), reason, "site", by);
    if (!changed) return c.json({ error: "not_found" }, 404);
    return queue(c, "fact_edit", owner, { ...payload, before: changed.before, after: changed.after, newFactId: changed.newId }, "Correction enregistrée.");
  });

  // Settings: admins only. The bot picks changes up within 30 seconds.
  app.get("/api/settings", async (c) => {
    if (!c.var.viewer.isAdmin) return c.json({ error: "forbidden" }, 403);
    const s = await readSettings(deps.db);
    return c.json({
      paused: s.paused,
      spontaneity: s.spontaneity,
      showFallbackTag: s.showFallbackTag,
      listenedChannelIds: s.listenedChannelIds,
      reflectionHours: s.reflectionHours,
      tidyDryRun: s.tidyDryRun,
      channels: s.channelDirectory,
    });
  });
  const settingsChange = z.object({
    paused: z.boolean().optional(),
    spontaneity: z.number().int().min(0).max(3).optional(),
    showFallbackTag: z.boolean().optional(),
    tidyDryRun: z.boolean().optional(),
    listenedChannelIds: z.array(z.string().regex(/^\d{17,20}$/)).max(300).optional(),
    reflectionHours: z
      .object({ midday: z.number().int().min(0).max(23), evening: z.number().int().min(0).max(23) })
      .refine((h) => h.midday < h.evening, "midday before evening")
      .optional(),
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
