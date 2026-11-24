import type { MoodIcon } from "../api.ts";

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

// The visor (rows 5 to 7, columns 4 to 11) carries the face.
const VISORS: Record<MoodIcon | "asleep", string[]> = {
  neutral: ["VVVVVVVV", "VEEEEEEV", "VVVVVVVV"],
  amused: ["VVEVVEVV", "VEVEEVEV", "VVVVVVVV"],
  curious: ["VVVVVEEV", "VEEVVEEV", "VEEVVVVV"],
  tired: ["VVVVVVVV", "VVVVVVVV", "VEEEEEEV"],
  annoyed: ["VEVVVVEV", "VVEEEEVV", "VVVVVVVV"],
  glitch: ["VEVEVVEV", "EEVVEEEV", "VVEVVVEE"],
  asleep: ["VVVVVVVV", "VVVVVVVV", "VzzzzzzV"],
};

const COLORS: Record<string, string> = {
  ".": "transparent",
  r: "#ff4757",
  w: "#e9e9ee",
  k: "#2b2b35",
  V: "#16161c",
  E: "#ff4757",
  g: "#6b6b78",
  d: "#5c1420",
  z: "#3a3a44",
  Z: "#a6a6b2",
};

function pixels(face: MoodIcon | "asleep"): string[] {
  const rows = MAP.map((r) => r.split(""));
  const visor = VISORS[face];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) (rows[5 + i] ?? [])[4 + j] = visor[i]?.[j] ?? "V";
  if (face === "asleep") for (const [y, x] of [[0, 13], [0, 14], [1, 14], [2, 13], [2, 14]] as const) (rows[y] ?? [])[x] = "Z";
  if (face === "glitch") {
    rows[3] = [".", ...(rows[3] ?? [])].slice(0, 16);
    rows[9] = [...(rows[9] ?? []).slice(1), "."];
  }
  return rows.flat();
}

const LABELS: Record<MoodIcon | "asleep", string> = {
  neutral: "neutre",
  amused: "amusé",
  curious: "curieux",
  tired: "fatigué",
  annoyed: "agacé",
  glitch: "en plein bug",
  asleep: "en veille",
};

export function Sprite({ cell = 12, asleep = false, mood = "neutral", still = false }: { cell?: number; asleep?: boolean; mood?: MoodIcon | null; still?: boolean }) {
  const face = asleep ? "asleep" : (mood ?? "neutral");
  const alive = !asleep && !still;
  return (
    <div
      className={`sprite${alive ? " bob" : ""}${face === "glitch" && alive ? " glitch" : ""}`}
      role="img"
      aria-label={`ARCHIVE-9, ${LABELS[face]}`}
      style={{ ["--cell" as string]: `${String(cell)}px` }}
    >
      {pixels(face).map((ch, i) => (
        <div key={i} className={ch === "E" && alive ? "eye" : undefined} style={{ background: COLORS[ch] ?? "transparent" }} />
      ))}
    </div>
  );
}

export const MOOD_LABELS = LABELS;

const SITE = [
  "................",
  ".wwwwwwwwwwwwww.",
  ".wrrrrrrrrrrrrw.",
  ".wrwrwrrrrrrrrw.",
  ".wwwwwwwwwwwwww.",
  ".wkkkkkkkkkkkkw.",
  ".wkggggggkkkkkw.",
  ".wkkkkkkkkkkkkw.",
  ".wkggggkggggkkw.",
  ".wkkkkkkkkkkkkw.",
  ".wkEEEkggggggkw.",
  ".wkkkkkkkkkkkkw.",
  ".wkggggggkkkkkw.",
  ".wkkkkkkkkkkkkw.",
  ".wwwwwwwwwwwwww.",
  "................",
];

/** The site's own picture: a window, still. */
export function SiteIcon({ cell = 6 }: { cell?: number }) {
  return (
    <div className="sprite" role="img" aria-label="Le site, une fenêtre en pixels" style={{ ["--cell" as string]: `${String(cell)}px` }}>
      {SITE.join("").split("").map((ch, i) => (
        <div key={i} style={{ background: COLORS[ch] ?? "transparent" }} />
      ))}
    </div>
  );
}
