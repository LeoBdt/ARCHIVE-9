import { SPRITE_COLORS, spriteRows, visorRows, type MoodIcon } from "@archive-9/core";
import { crc32, deflateSync } from "node:zlib";

const BACKGROUND = "#0a0a0d";
const SIZE = 512;

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, crc]);
}

export function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const line = y * (width * 3 + 1);
    raw[line] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), line + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const BANNER = { width: 960, height: 384, cell: 40 };

/**
 * The profile banner: its visor, blown up, so the mood reads at a glance, on the site's
 * background with a faint pixel grid.
 */
export function bannerPng(face: MoodIcon): Buffer {
  const visor = visorRows(face);
  const { width, height, cell } = BANNER;
  const left = width - 8 * cell - 80;
  const top = Math.round((height - 3 * cell) / 2);
  const grid = rgb("#141419");
  const bg = rgb(BACKGROUND);
  return png(width, height, (x, y) => {
    const i = Math.floor((x - left) / cell);
    const j = Math.floor((y - top) / cell);
    if (x >= left - cell && x < left + 9 * cell && y >= top - cell && y < top + 4 * cell) {
      const ch = i >= 0 && i < 8 && j >= 0 && j < 3 ? (visor[j]?.[i] ?? "V") : "k";
      return rgb(SPRITE_COLORS[ch] ?? BACKGROUND);
    }
    return x % 16 === 0 || y % 16 === 0 ? grid : bg;
  });
}

/** Its face as a 512 px PNG on the site's background, for the Discord avatar. */
export function avatarPng(face: MoodIcon): Buffer {
  const rows = spriteRows(face);
  const cell = SIZE / 16;
  return png(SIZE, SIZE, (x, y) => rgb(SPRITE_COLORS[rows[Math.floor(y / cell)]?.[Math.floor(x / cell)] ?? "."] ?? BACKGROUND));
}

/** Puts the face of this mood on its avatar and banner, when it changed. Discord limits how often. */
export async function showFace(user: { setAvatar: (a: Buffer) => Promise<unknown>; setBanner: (b: Buffer) => Promise<unknown> }, face: MoodIcon): Promise<void> {
  await user.setAvatar(avatarPng(face));
  await user.setBanner(bannerPng(face));
}
