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

const COLORS: Record<string, string> = {
  ".": "transparent",
  r: "#ff4757",
  w: "#e9e9ee",
  k: "#2b2b35",
  V: "#16161c",
  E: "#ff4757",
  g: "#6b6b78",
  d: "#5c1420",
};

const PIXELS = MAP.join("").split("");

export function Sprite({ cell = 12, asleep = false }: { cell?: number; asleep?: boolean }) {
  return (
    <div
      className={asleep ? "sprite" : "sprite bob"}
      role="img"
      aria-label={asleep ? "ARCHIVE-9, en veille" : "ARCHIVE-9, une unité d'archivage flottante à l'œil rouge"}
      style={{ ["--cell" as string]: `${String(cell)}px` }}
    >
      {PIXELS.map((ch, i) => {
        const eye = ch === "E";
        const color = eye && asleep ? "#3a3a44" : (COLORS[ch] ?? "transparent");
        return <div key={i} className={eye && !asleep ? "eye" : undefined} style={{ background: color }} />;
      })}
    </div>
  );
}
