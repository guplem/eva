/**
 * The release workflow publishes a release after each change to `main`. The conventional-commit
 * types since the last release decide its version, so no person picks a number.
 */
import { isNewerVersion } from "./release-verification.ts";

export interface ReleaseCommit {
  readonly subject: string;
  readonly body: string;
  /** The short commit hash. GitHub links it in a release body. */
  readonly hash?: string;
  /** The pull request that merged this commit, if any. */
  readonly pullRequest?: { readonly number: number; readonly title: string };
}

const pullRequestMerge = /^Merge pull request #(\d+) from /;

/** The number of the pull request that a GitHub merge commit merges, or null. */
export function mergedPullRequest(subject: string): number | null {
  const number = pullRequestMerge.exec(subject)?.[1];
  return number === undefined ? null : Number(number);
}

/** How much a commit changes the executable. `null` means it changes nothing in it. */
export type ReleaseChange = "breaking" | "feature" | "fix";

const featureTypes = new Set(["feat"]);
const fixTypes = new Set(["fix", "perf", "refactor", "build"]);
const silentTypes = new Set(["docs", "test", "chore", "ci", "style"]);
const conventionalSubject = /^(\w+)(?:\([^)]*\))?(!)?: \S/;
// `git revert` writes this subject, and a revert changes the executable.
const revertPrefix = 'Revert "';
const breakingFooter = /^BREAKING[ -]CHANGE: /m;

export function isConventionalSubject(subject: string): boolean {
  if (subject.startsWith(revertPrefix)) return true;
  const type = conventionalSubject.exec(subject)?.[1];
  return type !== undefined && (featureTypes.has(type) || fixTypes.has(type) || silentTypes.has(type));
}

export function commitChange(commit: ReleaseCommit): ReleaseChange | null {
  const match = conventionalSubject.exec(commit.subject);
  if (match?.[2] === "!" || breakingFooter.test(commit.body)) return "breaking";
  const type = match?.[1];
  if (type !== undefined && featureTypes.has(type)) return "feature";
  if (type !== undefined && silentTypes.has(type)) return null;
  // An unknown subject reached `main` without the pull request check. Releasing it is safer than dropping it.
  return "fix";
}

const versionTag = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The highest `vX.Y.Z` tag, without its `v`, or null when there is none. */
export function latestVersionTag(tags: readonly string[]): string | null {
  let latest: string | null = null;
  for (const tag of tags) {
    if (!versionTag.test(tag)) continue;
    const version = tag.slice(1);
    if (latest === null || isNewerVersion(version, latest)) latest = version;
  }
  return latest;
}

export interface NextReleaseInputs {
  /** The version of the last release, or null before the first one. */
  readonly lastVersion: string | null;
  /** The `package.json` version: the first release, or a step that a person sets by hand. */
  readonly packageVersion: string;
  readonly commits: readonly ReleaseCommit[];
}

/** The version of the next release, or null when nothing since the last one changes the executable. */
export function nextReleaseVersion(inputs: NextReleaseInputs): string | null {
  const { lastVersion, packageVersion } = inputs;
  if (lastVersion === null || isNewerVersion(packageVersion, lastVersion)) return packageVersion;
  const changes = inputs.commits.map(commitChange);
  const [major = 0, minor = 0, patch = 0] = lastVersion.split(".").map(Number);
  // Even before 1.0, a break raises the major number: the update policy reads only the numbers (issue 97).
  if (changes.includes("breaking")) return `${String(major + 1)}.0.0`;
  if (changes.includes("feature")) return `${String(major)}.${String(minor + 1)}.0`;
  if (changes.includes("fix")) return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
  return null;
}

/** The sections of the release notes, in the order that a reader needs them. */
export const releaseNoteSections: readonly { change: ReleaseChange; title: string }[] = [
  { change: "breaking", title: "Breaking changes" },
  { change: "feature", title: "New features" },
  { change: "fix", title: "Fixes and other changes" },
];

export const noChangeNotes = "No change to the executable.";

/** The commit list sits in this block. Its lines are details, not changes to summarize. */
export const detailsStart = "<details>";
export const detailsEnd = "</details>";

const changeRank: Readonly<Record<ReleaseChange, number>> = { fix: 0, feature: 1, breaking: 2 };

/** One line of the notes: a pull request, or a commit that came with none. */
interface ReleaseNoteEntry {
  text: string;
  change: ReleaseChange;
}

/**
 * The release notes: each pull request that changes the executable, under its largest change,
 * then each such commit in a collapsed detail view.
 */
export function releaseNotes(commits: readonly ReleaseCommit[]): string {
  const changed = commits.flatMap((commit) => {
    const change = commitChange(commit);
    return change === null ? [] : [{ commit, change }];
  });
  if (changed.length === 0) return `${noChangeNotes}\n`;
  const entries: ReleaseNoteEntry[] = [];
  const byPullRequest = new Map<number, ReleaseNoteEntry>();
  for (const { commit, change } of changed) {
    const pullRequest = commit.pullRequest;
    if (pullRequest === undefined) {
      entries.push({ text: commit.subject, change });
      continue;
    }
    const entry = byPullRequest.get(pullRequest.number);
    if (entry === undefined) {
      const created = { text: `${pullRequest.title} (#${String(pullRequest.number)})`, change };
      byPullRequest.set(pullRequest.number, created);
      entries.push(created);
    } else if (changeRank[change] > changeRank[entry.change]) {
      entry.change = change;
    }
  }
  const parts: string[] = [];
  for (const { change, title } of releaseNoteSections) {
    const lines = entries.filter((entry) => entry.change === change).map((entry) => `- ${entry.text}`);
    if (lines.length > 0) parts.push(`## ${title}\n\n${lines.join("\n")}\n`);
  }
  const commitLines = changed.map(({ commit }) =>
    commit.hash === undefined ? `- ${commit.subject}` : `- ${commit.subject} (${commit.hash})`,
  );
  parts.push(`${detailsStart}\n<summary>Commits</summary>\n\n${commitLines.join("\n")}\n\n${detailsEnd}\n`);
  return parts.join("\n");
}
