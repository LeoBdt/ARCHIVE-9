// Draws the favicon, the touch icon and the link preview card from the sprite.
// Run: node scripts/icons.ts (writes to public/).
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const SPRITE = [
  "................",
  ".......rr.......",
  ".......ww.......",
  "...wwwwwwwwww...",
  "..wkkkkkkkkkkw..",
  "..wkVVVVVVVVkw..",
  "..wkVEEEEEEVkw..",
  "..wkVVVVVVVVkw..",
  "..wkkkkkkkkkkw..",
  "..wkgkgkgkgkkw..",
  "..wkkkkkkkkkkw..",
  "...wwwwwwwwww...",
  "................",
  ".....dddddd.....",
  "......dddd......",
  "................",
];

const COLORS: Record<string, string> = {
  r: "#ff4757",
  w: "#e9e9ee",
  k: "#2b2b35",
  V: "#16161c",
  E: "#ff4757",
  g: "#6b6b78",
  d: "#5c1420",
};

const BG = "#0a0a0d";
const RED = "#ff4757";
const GREY = "#b9b9c3";

// 5×7 pixel letters, just the ones the card needs.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

type Rgba = [number, number, number, number];
const rgba = (hex: string, a = 255): Rgba => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background?: string) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    if (background) this.rect(0, 0, width, height, background);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const [r, g, b, a] = rgba(color);
    for (let j = Math.max(0, y); j < Math.min(this.height, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(this.width, x + w); i++) this.data.set([r, g, b, a], (j * this.width + i) * 4);
    }
  }

  sprite(x: number, y: number, cell: number, rows = SPRITE): void {
    rows.forEach((row, j) => {
      Array.from(row).forEach((ch, i) => {
        const color = COLORS[ch];
        if (color) this.rect(x + i * cell, y + j * cell, cell, cell, color);
      });
    });
  }

  text(x: number, y: number, scale: number, text: string, color: string): void {
    Array.from(text).forEach((ch, n) => {
      const glyph = FONT[ch];
      if (!glyph) throw new Error(`no glyph for ${ch}`);
      glyph.forEach((row, j) => {
        Array.from(row).forEach((bit, i) => {
          if (bit === "#") this.rect(x + n * 6 * scale + i * scale, y + j * scale, scale, scale, color);
        });
      });
    });
  }

  /** Stepped pixel frame, corners left out, like the site's borders. */
  frame(x: number, y: number, w: number, h: number, t: number, color: string): void {
    this.rect(x + t, y, w - 2 * t, t, color);
    this.rect(x + t, y + h - t, w - 2 * t, t, color);
    this.rect(x, y + t, t, h - 2 * t, color);
    this.rect(x + w - t, y + t, t, h - 2 * t, color);
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let j = 0; j < this.height; j++) {
      raw[j * (this.width * 4 + 1)] = 0;
      raw.set(this.data.subarray(j * this.width * 4, (j + 1) * this.width * 4), j * (this.width * 4 + 1) + 1);
    }
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(4);
      head.writeUInt32BE(body.length);
      const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(typed));
      return Buffer.concat([head, typed, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  }
}

const textWidth = (text: string, scale: number) => text.length * 6 * scale - scale;
const out = new URL("../public/", import.meta.url);

// Favicon: the sprite without its empty top and bottom rows, on the site's black.
const rows = SPRITE.slice(1, 15).map((row) => row.slice(1, 15));
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">`,
  `<rect width="16" height="16" fill="${BG}"/>`,
  ...rows.flatMap((row, j) =>
    Array.from(row).flatMap((ch, i) => (COLORS[ch] ? [`<rect x="${String(i + 1)}" y="${String(j + 1)}" width="1" height="1" fill="${COLORS[ch] ?? ""}"/>`] : [])),
  ),
  "</svg>",
].join("");
writeFileSync(new URL("favicon.svg", out), svg);

const favicon = new Canvas(32, 32, BG);
favicon.sprite(0, 1, 2);
writeFileSync(new URL("favicon-32.png", out), favicon.png());

const touch = new Canvas(180, 180, BG);
touch.sprite(10, 10, 10);
writeFileSync(new URL("apple-touch-icon.png", out), touch.png());

// Link preview card, 1200×630.
const card = new Canvas(1200, 630, BG);
card.frame(40, 40, 1120, 550, 6, RED);
card.sprite(110, 171, 18);
const title = "ARCHIVE-9";
card.text(450, 236, 12, title, RED);
card.text(450, 360, 6, "IA D'ARCHIVAGE", GREY);
card.rect(450 + textWidth(title, 12) + 32, 236, 24, 7 * 12, RED);
writeFileSync(new URL("og.png", out), card.png());

console.log("icons written");
