/**
 * The release workflow publishes a release after each change to `main`. The conventional-commit
 * types since the last release decide its version, so no person picks a number.
 */
import { isNewerVersion } from "./release-verification.ts";

export interface ReleaseCommit {
  readonly subject: string;
  readonly body: string;
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

/** The release notes: each commit that changes the executable, under the size of its change. */
export function releaseNotes(commits: readonly ReleaseCommit[]): string {
  const parts: string[] = [];
  for (const { change, title } of releaseNoteSections) {
    const subjects = commits.filter((commit) => commitChange(commit) === change).map((commit) => commit.subject);
    if (subjects.length > 0) parts.push(`## ${title}\n\n${subjects.map((subject) => `- ${subject}`).join("\n")}\n`);
  }
  return parts.length === 0 ? `${noChangeNotes}\n` : parts.join("\n");
}
