import { randomUUID } from "node:crypto";
import { writeChangelog, type AiRuntime } from "@archive-9/ai";
import { commitTouches, nextSiteVersion, versionName, type ReleaseCommit, type ReleaseKind } from "@archive-9/core";
import { latestReleases, recordAiUsage, saveRelease, type Database } from "@archive-9/db";
import type { Logger } from "./logger.ts";

const MAX_COMMITS = 20;

interface GitHubCommit {
  sha: string;
  commit: { message: string };
  files?: { filename: string }[];
}

async function github<T>(repo: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "archive-9-bot" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub ${String(response.status)} on ${path}`);
  return (await response.json()) as T;
}

/** The commits between two versions, oldest first, each with the files it touched. */
async function commitsBetween(repo: string, from: string | null, to: string): Promise<ReleaseCommit[]> {
  const list = from
    ? (await github<{ commits: GitHubCommit[] }>(repo, `/compare/${from}...${to}`)).commits.slice(-MAX_COMMITS)
    : [await github<GitHubCommit>(repo, `/commits/${to}`)];
  const commits: ReleaseCommit[] = [];
  for (const c of list) {
    const full = c.files ? c : await github<GitHubCommit>(repo, `/commits/${c.sha}`);
    const [title = "", ...rest] = c.commit.message.split("\n");
    commits.push({ sha: c.sha, title: title.trim(), body: rest.join("\n").trim(), files: (full.files ?? []).map((f) => f.filename) });
  }
  return commits;
}

/**
 * Writes the changelog of the version that just started, once: what changed in the bot
 * and, when the site moved too, its new number. GitHub is only read here; the site reads
 * the result from the database.
 */
export async function recordRelease(deps: { db: Database; ai: AiRuntime; log: Logger; repo: string; sha: string }): Promise<void> {
  const { db, ai, log, repo, sha } = deps;
  if (!/^[0-9a-f]{40}$/i.test(sha)) return;
  const [core] = await latestReleases(db, "core", 1);
  if (core?.sha === sha) return;
  const [site] = await latestReleases(db, "site", 1);
  const commits = await commitsBetween(repo, core?.sha ?? null, sha);

  const write = async (kind: ReleaseKind, label: string, own: ReleaseCommit[]) => {
    const outcome = own.length ? await writeChangelog(ai, { kind, label, commits: own }) : { value: null, usage: [] };
    await recordAiUsage(db, outcome.usage.map((u) => ({ ...u, runId: randomUUID(), detail: `changelog ${kind} ${label}` })));
    const items = outcome.value?.items.length ? outcome.value.items : own.map((c) => ({ text: c.title, sha: c.sha.slice(0, 7) }));
    await saveRelease(db, {
      kind,
      label,
      sha,
      previousSha: kind === "core" ? (core?.sha ?? null) : (site?.sha ?? null),
      comment: outcome.value?.comment ?? (own.length ? null : "Rien de neuf de ce côté."),
      items,
      commits: own.map((c) => ({ sha: c.sha, title: c.title })),
    });
  };

  const coreCommits = commits.filter((c) => commitTouches(c.files).has("core"));
  const siteCommits = commits.filter((c) => commitTouches(c.files).has("site"));
  await write("core", versionName(sha) ?? sha.slice(0, 7), coreCommits);
  if (siteCommits.length > 0 || !site) await write("site", nextSiteVersion(site?.label ?? null, siteCommits.map((c) => c.title)), siteCommits);
  log.info({ core: coreCommits.length, site: siteCommits.length }, "release recorded");
}
