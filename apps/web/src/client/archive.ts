import type { Category, FactNature, SelfStateView } from "./api.ts";

/** Fact categories as drawers: label and the colour of their edge. */
export const CATEGORIES: Record<string, { label: string; color: string }> = {
  identity: { label: "IDENTITÉ", color: "#e9e9ee" },
  games: { label: "JEUX", color: "#7cc4ff" },
  projects: { label: "PROJETS", color: "#6ee7a8" },
  habits: { label: "HABITUDES", color: "#5ad1c9" },
  tastes: { label: "GOÛTS", color: "#ff9f5a" },
  humor: { label: "HUMOUR", color: "#f5c04a" },
  in_jokes: { label: "BLAGUES INTERNES", color: "#c4a0ff" },
  anecdotes: { label: "ANECDOTES", color: "#ff7ab6" },
  relationships: { label: "LIENS", color: "#ff4757" },
  writing_style: { label: "FAÇON D'ÉCRIRE", color: "#a0b4ff" },
  other: { label: "DIVERS", color: "#b9b9c3" },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES);

/** A drawer's label and colour, from the list the server sent or the starting ones. */
export function categoryOf(key: string, known: ReadonlyMap<string, Category>): { label: string; color: string } {
  const c = known.get(key) ?? CATEGORIES[key];
  return c ? { label: c.label, color: c.color } : { label: key, color: "#b9b9c3" };
}

/** The stamp on an index card. Inks are dark enough to read on the card's cream. */
export function stamp(nature: FactNature, reporter: string | null): { text: string; ink: string; dashed: boolean; tilt: number } {
  switch (nature) {
    case "fact":
      return { text: "FAIT", ink: "#1a1a20", dashed: false, tilt: -2 };
    case "reported":
      return { text: reporter ? `SELON ${reporter.toUpperCase()}` : "RAPPORTÉ", ink: "#1d4f7a", dashed: false, tilt: 3 };
    case "probable_joke":
      return { text: "POUR RIRE", ink: "#7a5400", dashed: false, tilt: -9 };
    case "inference":
      return { text: "DÉDUIT ?", ink: "#5a3a8a", dashed: true, tilt: 1 };
  }
}

/** Confidence 0…1 as 0…5 marks. */
export function reliability(confidence: number): number {
  return Math.max(0, Math.min(5, Math.round(confidence * 5)));
}

export function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : "0";
}

interface Change {
  text: string;
  color: string;
}

/** What changed from one version of itself to the next. */
export function diffStates(before: SelfStateView | undefined, after: SelfStateView): Change[] {
  if (!before) return [{ text: `+ ${String(after.opinions.length)} opinions, ${String(after.runningJokes.length)} blagues`, color: "var(--green)" }];
  const list = (a: string[] = [], b: string[] = [], mark: string) => [
    ...b.filter((x) => !a.includes(x)).map((x) => ({ text: `${mark === "◆" ? "◆" : "+"} ${x}`, color: mark === "◆" ? "var(--red)" : "var(--green)" })),
    ...a.filter((x) => !b.includes(x)).map((x) => ({ text: `− ${x}`, color: "var(--red-soft)" })),
  ];
  return [...list(before.resolutions, after.resolutions, "◆"), ...list(before.opinions, after.opinions, "+"), ...list(before.runningJokes, after.runningJokes, "+")];
}

