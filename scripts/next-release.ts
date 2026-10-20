/**
 * Picks the version of the next release from the commits since the last `v*` tag, and writes
 * its release notes. It prints the version, or nothing when no commit changes the executable.
 * In GitHub Actions it also sets the `version` step output.
 *
 * Usage: bun run scripts/next-release.ts <notes file>
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  latestVersionTag,
  mergedPullRequest,
  nextReleaseVersion,
  releaseNotes,
  type ReleaseCommit,
} from "../src/core/updates/release-version.ts";

const notesPath = process.argv[2];
if (notesPath === undefined) {
  process.stderr.write("Usage: bun run scripts/next-release.ts <notes file>\n");
  process.exit(2);
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    process.stderr.write(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
    process.exit(1);
  }
  return result.stdout.toString();
}

const lastVersion = latestVersionTag(git(["tag", "--list", "v*", "--merged", "HEAD"]).split(/\r?\n/));

interface LoggedCommit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly subject: string;
  readonly body: string;
}

function log(args: string[]): LoggedCommit[] {
  // Unit and record separators keep a commit body with blank lines in one piece.
  return git(["log", "--format=%h%x1f%p%x1f%s%x1f%b%x1e", ...args])
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash = "", parents = "", subject = "", body = ""] = record.split("\x1f");
      return { hash, parents: parents.split(" ").filter((parent) => parent.length > 0), subject, body };
    });
}

// Each commit on the first-parent line of main is a pull request merge or a direct commit.
// A merge brings the commits between its first parent and its other parents.
const commits: ReleaseCommit[] = [];
for (const entry of log(["--first-parent", lastVersion === null ? "HEAD" : `v${lastVersion}..HEAD`])) {
  const [mainParent, ...mergedParents] = entry.parents;
  if (mainParent === undefined || mergedParents.length === 0) {
    commits.push({ subject: entry.subject, body: entry.body, hash: entry.hash });
    continue;
  }
  const merged = log(["--no-merges", ...mergedParents, `^${mainParent}`]);
  const number = mergedPullRequest(entry.subject);
  // GitHub writes the pull request title as the first line of the merge body.
  const firstBodyLine = entry.body.split(/\r?\n/)[0]?.trim() ?? "";
  const title = firstBodyLine === "" ? (merged.at(-1)?.subject ?? entry.subject) : firstBodyLine;
  const pullRequest = number === null ? undefined : { number, title };
  for (const { subject, body, hash } of merged) {
    commits.push(pullRequest === undefined ? { subject, body, hash } : { subject, body, hash, pullRequest });
  }
}

const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const version = nextReleaseVersion({ lastVersion, packageVersion, commits });

// The first release would list the whole history, which helps nobody.
writeFileSync(notesPath, lastVersion === null ? "The first release of Eva.\n" : releaseNotes(commits));
const outputPath = process.env["GITHUB_OUTPUT"];
if (outputPath !== undefined) appendFileSync(outputPath, `version=${version ?? ""}\n`);
process.stdout.write(
  version === null
    ? `No commit since v${lastVersion ?? "?"} changes the executable. Nothing to release.\n`
    : `${version}\n`,
);
