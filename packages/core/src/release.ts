/** A commit as the changelog needs it. */
export interface ReleaseCommit {
  sha: string;
  /** First line of the message. */
  title: string;
  /** The rest of the message: a squash merge keeps the PR's details there. */
  body: string;
  files: string[];
}

export type ReleaseKind = "core" | "site";

/** What a commit changed: the bot (core), the site, both, or neither (docs, CI). */
export function commitTouches(files: readonly string[]): Set<ReleaseKind> {
  const kinds = new Set<ReleaseKind>();
  for (const file of files) {
    if (file.startsWith("apps/web/")) kinds.add("site");
    else if (file.startsWith("apps/bot/") || file.startsWith("packages/ai/") || file.startsWith("packages/core/")) kinds.add("core");
    else if (file.startsWith("packages/db/")) {
      // The database serves both: a site page query only touches the site.
      kinds.add(file.includes("site") ? "site" : "core");
    }
  }
  return kinds;
}

/** Site version x.y.z from the previous one: a new feature bumps y, anything else z. */
export function nextSiteVersion(previous: string | null, titles: readonly string[]): string {
  const [major = 1, minor = 0, patch = 0] = (previous ?? "").split(".").map(Number);
  if (!previous) return "1.0.0";
  const feature = titles.some((t) => /^feat(\(|!|:)/.test(t));
  return feature ? `${String(major)}.${String(minor + 1)}.0` : `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}
