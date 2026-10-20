/**
 * Fails when a tracked file holds content that must never reach the public repository:
 * an absolute home path, or a string from the owner's private denylist.
 *
 * The denylist lives outside the repository (one string per line), at the path in
 * EVA_PRIVATE_DENYLIST, or at ~/.config/eva-dev/denylist.txt. Without it, only the
 * home path check runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const homePathPatterns: readonly RegExp[] = [
  /[A-Za-z]:\\+Users\\+[A-Za-z0-9._-]+/,
  /[A-Za-z]:\/Users\/[A-Za-z0-9._-]+/,
  /\/home\/[a-z][a-z0-9._-]+\//,
  /\/Users\/[A-Za-z][A-Za-z0-9._-]+\//,
];

const thisFile = "scripts/check-public-content.ts";

function trackedFiles(): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { stdout: "pipe" });
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0 && path !== thisFile);
}

function loadDenylist(): string[] {
  const configured = process.env["EVA_PRIVATE_DENYLIST"];
  const path = configured ?? join(homedir(), ".config", "eva-dev", "denylist.txt");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

const denylist = loadDenylist().map((entry) => entry.toLowerCase());
const findings: string[] = [];

for (const path of trackedFiles()) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path);
  if (isBinary(content)) continue;
  const lines = content.toString("utf-8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (homePathPatterns.some((pattern) => pattern.test(line))) {
      findings.push(`${path}:${index + 1}: absolute home path`);
    }
    const lowered = line.toLowerCase();
    if (denylist.some((entry) => lowered.includes(entry))) {
      findings.push(`${path}:${index + 1}: a string from the private denylist`);
    }
  });
}

if (findings.length > 0) {
  console.error("Public content check failed:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(`Public content check passed (${denylist.length} private strings checked).`);
