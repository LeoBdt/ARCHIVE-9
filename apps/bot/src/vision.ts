import { randomUUID } from "node:crypto";
import { seeImage, type AiRuntime, type ImageFrame } from "@archive-9/ai";
import { aiCostSince, recordAiUsage, saveImageDescription, type Database, type PendingImage } from "@archive-9/db";
import { GifReader } from "omggif";
import { png } from "./discord/avatar.ts";
import type { Logger } from "./logger.ts";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_GIF_PIXELS = 1_200_000;
const DAY_MS = 24 * 60 * 60_000;

export interface VisionDeps {
  db: Database;
  ai: AiRuntime;
  log: Logger;
  dailyBudgetUsd: number;
}

/** Three moments of a GIF (start, middle, end), drawn over black, as PNGs. */
export function gifFrames(bytes: Uint8Array): ImageFrame[] {
  const gif = new GifReader(bytes);
  const { width, height } = gif;
  const count = gif.numFrames();
  if (count <= 1 || width * height > MAX_GIF_PIXELS) return [];
  const wanted = [...new Set([0, Math.floor(count / 2), count - 1])];
  const canvas = new Uint8Array(width * height * 4);
  const frames: ImageFrame[] = [];
  for (let i = 0; i <= (wanted.at(-1) ?? 0); i++) {
    // Frames only redraw part of the picture: they are drawn one over the other.
    gif.decodeAndBlitFrameRGBA(i, canvas);
    if (!wanted.includes(i)) continue;
    const data = png(width, height, (x, y) => {
      const o = (y * width + x) * 4;
      const a = (canvas[o + 3] ?? 0) / 255;
      return [Math.round((canvas[o] ?? 0) * a), Math.round((canvas[o + 1] ?? 0) * a), Math.round((canvas[o + 2] ?? 0) * a)];
    });
    frames.push({ data, mediaType: "image/png" });
  }
  return frames;
}

/** Downloads an image and turns it into what the model can read. Throws with a short reason. */
export async function loadFrames(url: string): Promise<{ frames: ImageFrame[]; gif: boolean }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`téléchargement impossible (${String(response.status)})`);
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`format non pris en charge (${type || "inconnu"})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("image trop lourde");
  if (type === "image/gif") {
    const frames = gifFrames(bytes);
    if (frames.length > 0) return { frames, gif: true };
  }
  return { frames: [{ data: bytes, mediaType: type }], gif: false };
}

/** Today's vision spending is under the budget. */
export async function visionAllowed(deps: VisionDeps): Promise<boolean> {
  return (await aiCostSince(deps.db, ["vision"], new Date(Date.now() - DAY_MS))) < deps.dailyBudgetUsd;
}

/** Looks at one image once, stores what it understood (or why it couldn't), and returns it. */
export async function describeImage(deps: VisionDeps, image: PendingImage, store = true): Promise<string | null> {
  try {
    const { frames, gif } = await loadFrames(image.url);
    const outcome = await seeImage(deps.ai, { frames, kind: gif ? "gif" : image.kind === "embed" ? "embed" : "image", caption: image.content, name: image.name });
    await recordAiUsage(deps.db, outcome.usage.map((u) => ({ ...u, runId: randomUUID(), detail: `image ${image.kind}` })));
    if (store) await saveImageDescription(deps.db, image.id, { description: outcome.description, model: outcome.ref?.model ?? null, error: outcome.description ? null : "aucun modèle n'a pu la lire" });
    return outcome.description;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "erreur inconnue";
    deps.log.debug({ imageId: image.id, reason }, "image not seen");
    if (store) await saveImageDescription(deps.db, image.id, { description: null, model: null, error: reason });
    return null;
  }
}

/** Looks at pending images, a few at a time, while the budget allows. Returns how many it saw. */
export async function describePending(deps: VisionDeps, images: PendingImage[]): Promise<number> {
  let seen = 0;
  for (let i = 0; i < images.length; i += 3) {
    if (!(await visionAllowed(deps))) {
      deps.log.info({ left: images.length - i }, "vision budget spent for today");
      break;
    }
    const batch = await Promise.all(images.slice(i, i + 3).map((image) => describeImage(deps, image)));
    seen += batch.filter(Boolean).length;
  }
  return seen;
}
