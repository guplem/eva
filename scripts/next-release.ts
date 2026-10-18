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
// Unit and record separators keep a commit body with blank lines in one piece.
const log = git([
  "log",
  "--no-merges",
  "--format=%s%x1f%b%x1e",
  lastVersion === null ? "HEAD" : `v${lastVersion}..HEAD`,
]);
const commits: ReleaseCommit[] = log
  .split("\x1e")
  .map((record) => record.trim())
  .filter((record) => record.length > 0)
  .map((record) => {
    const [subject = "", body = ""] = record.split("\x1f");
    return { subject, body };
  });

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
