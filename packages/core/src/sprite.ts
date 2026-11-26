import type { MoodIcon } from "./domain.ts";

// ARCHIVE-9 as a 16×16 sprite: a floating archive unit with a red visor.
const MAP = [
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

// The visor (rows 5 to 7, columns 4 to 11) carries the face. Same faces as the site.
const VISORS: Record<MoodIcon, string[]> = {
  neutral: ["VVVVVVVV", "VEEEEEEV", "VVVVVVVV"],
  amused: ["VVEVVEVV", "VEVEEVEV", "VVVVVVVV"],
  curious: ["VVVVVEEV", "VEEVVEEV", "VEEVVVVV"],
  tired: ["VVVVVVVV", "VVVVVVVV", "VEEEEEEV"],
  annoyed: ["VEVVVVEV", "VVEEEEVV", "VVVVVVVV"],
  glitch: ["VEVEVVEV", "EEVVEEEV", "VVEVVVEE"],
};

export const SPRITE_COLORS: Record<string, string> = {
  r: "#ff4757",
  w: "#e9e9ee",
  k: "#2b2b35",
  V: "#16161c",
  E: "#ff4757",
  g: "#6b6b78",
  d: "#5c1420",
};

/** The visor alone (3 rows of 8), the face's expression. */
export function visorRows(face: MoodIcon): string[] {
  return [...VISORS[face]];
}

/** The 16 rows of the sprite with this face, one character per pixel ("." is empty). */
export function spriteRows(face: MoodIcon): string[] {
  const rows = MAP.map((r) => r.split(""));
  const visor = VISORS[face];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) (rows[5 + i] ?? [])[4 + j] = visor[i]?.[j] ?? "V";
  if (face === "glitch") {
    rows[3] = [".", ...(rows[3] ?? [])].slice(0, 16);
    rows[9] = [...(rows[9] ?? []).slice(1), "."];
  }
  return rows.map((r) => r.join(""));
}
