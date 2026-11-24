/**
 * Runs the unit tests, then fails when one test file took too long (#1043).
 * Bun runs the files in parallel, and a CI job can end no sooner than its slowest file. So a slow file
 * slows every pull request. The arguments go to `bun test`, such as `--coverage` or `--shard=1/3`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type FileTimings = Record<string, number>;

interface SlowFile {
  file: string;
  ms: number;
}

/**
 * The slowest file on Linux took 31 s, and on a Windows runner 334 s, where each git process is
 * slow. A Windows file can take 40% longer on a slow runner, so its limit leaves that much room.
 */
export function fileLimitMs(platform: NodeJS.Platform): number {
  return platform === "win32" ? 450_000 : 40_000;
}

export function filesOverLimit(timings: FileTimings, limitMs: number): SlowFile[] {
  return Object.entries(timings)
    .filter(([, ms]) => ms > limitMs)
    .map(([file, ms]) => ({ file, ms }))
    .sort((first, second) => second.ms - first.ms);
}

/** Reads the `{ "version": 1, "files": { path: ms } }` file that `--update-timings` writes. */
export function parseTimings(text: string): FileTimings {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("files" in parsed)) {
    throw new Error("The timings file has no files.");
  }
  const files: unknown = parsed.files;
  if (typeof files !== "object" || files === null) throw new Error("The timings file has no files.");
  const timings: FileTimings = {};
  for (const [file, ms] of Object.entries(files)) {
    if (typeof ms !== "number") throw new Error(`The time of ${file} is not a number.`);
    timings[file] = ms;
  }
  return timings;
}

async function runTests(bunTestArguments: readonly string[]): Promise<number> {
  const folder = mkdtempSync(join(tmpdir(), "eva-test-timings-"));
  try {
    // Bun writes the measured times to the first `--timings` file. With `--shard`, it writes only the
    // files of this shard. Without `--shard`, it also copies the entries of any other `--timings` file,
    // so a run without `--shard` must pass no other one.
    const measured = join(folder, "timings.json");
    writeFileSync(measured, JSON.stringify({ version: 1, files: {} }));
    const tests = Bun.spawn(
      [
        process.execPath,
        "test",
        "--timeout",
        "30000",
        "--parallel",
        `--timings=${measured}`,
        "--update-timings",
        ...bunTestArguments,
      ],
      { stdio: ["inherit", "inherit", "inherit"] },
    );
    const exitCode = await tests.exited;
    if (exitCode !== 0) return exitCode;
    const limitMs = fileLimitMs(process.platform);
    const timings = parseTimings(readFileSync(measured, "utf8"));
    // An empty file means that Bun measured nothing, and the check would pass with nothing checked.
    if (Object.keys(timings).length === 0) {
      process.stderr.write("Bun wrote no test times, so the time limit cannot be checked.\n");
      return 1;
    }
    const slowFiles = filesOverLimit(timings, limitMs);
    if (slowFiles.length === 0) return 0;
    process.stderr.write(`\nThese test files take more than ${String(limitMs / 1000)} s each:\n`);
    for (const slow of slowFiles) process.stderr.write(`  ${slow.file}: ${(slow.ms / 1000).toFixed(1)} s\n`);
    process.stderr.write("Split each file by topic, or make its tests run fewer processes (test/AGENTS.md).\n");
    return 1;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await runTests(process.argv.slice(2)));
