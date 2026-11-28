/**
 * `bun run smoke:shell-sandbox`: runs Eva's real `eva shell-sandbox` wrapper against the real
 * sandbox of this computer, as pi's bash tool does in a walled Project chat (#759). CI runs no real
 * sandbox, so this script is the check on a real Linux or macOS machine. It needs bubblewrap, socat
 * and ripgrep on Linux. It builds a neutral demo vault and instance folder in the temporary folder.
 *
 *   bun run smoke:shell-sandbox            # with `bun run src/main.ts`
 *   bun run smoke:shell-sandbox ./dist/eva # with a built executable
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embeddedSeccompHelper, installSeccompHelper } from "../src/core/shell-sandbox/seccomp-helper.ts";
import { piShellWallConfig } from "../src/engines/pi/pi-shell-wall.ts";

if (process.platform === "win32") {
  console.log("Windows has no shell sandbox: skipped.");
  process.exit(0);
}
const evaCommand =
  process.argv[2] === undefined ? [process.execPath, join(import.meta.dir, "..", "src", "main.ts")] : [process.argv[2]];

const root = mkdtempSync(join(tmpdir(), "eva-smoke-sandbox-"));
const vault = join(root, "vault");
const project = join(vault, "Projects", "2025-03-02-1015-example-app");
const clone = join(project, "repos", "clone-0");
const otherClone = join(project, "repos", "clone-1");
const instance = join(root, "eva");
for (const folder of [clone, otherClone, join(instance, "bin"), join(instance, "engines", "pi-agent", "sessions")])
  mkdirSync(folder, { recursive: true });
writeFileSync(join(vault, "Life.md"), "a private note\n");
writeFileSync(join(project, "plan.md"), "the project's plan\n");
writeFileSync(join(otherClone, "other.txt"), "another clone\n");
writeFileSync(join(instance, "secrets.json"), '{"token":"demo"}\n');
writeFileSync(join(instance, "engines", "pi-agent", "sessions", "chat.jsonl"), "a chat's history\n");
// A clone has its repository before its chat starts.
const git = Bun.spawnSync(["git", "-c", "user.name=Demo", "-c", "user.email=demo@example.com", "init", "-q"], {
  cwd: clone,
  env: {
    PATH: process.env["PATH"] ?? "",
    HOME: root,
    GIT_CONFIG_GLOBAL: join(root, "no-gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  },
});
Bun.spawnSync(
  ["git", "-c", "user.name=Demo", "-c", "user.email=demo@example.com", "commit", "-q", "--allow-empty", "-m", "first"],
  {
    cwd: clone,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: root,
      GIT_CONFIG_GLOBAL: join(root, "no-gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
  },
);
if (git.exitCode !== 0) throw new Error("git init failed.");

const seccompFile = installSeccompHelper(await embeddedSeccompHelper(), join(instance, "bin"));
const wall = {
  area: clone,
  closed: [vault, instance, join(project, "repos")],
  readable: [join(instance, "bin")],
  readOnly: [project],
  socketFilter: true,
  shellSandbox: true,
};
// No global or system git config: the person's own one could sign each commit through a program outside.
const environment = {
  PATH: process.env["PATH"] ?? "",
  HOME: root,
  GIT_CONFIG_GLOBAL: join(root, "no-gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
};
const wallFile = join(instance, "wall.json");
const machine = { runtimeFolder: null, platform: process.platform };
writeFileSync(wallFile, JSON.stringify(piShellWallConfig(wall, environment, seccompFile, machine)));

async function run(command: string): Promise<{ code: number; output: string }> {
  const child = Bun.spawn([...evaCommand, "shell-sandbox", wallFile, command], {
    cwd: clone,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: root,
      GIT_CONFIG_GLOBAL: join(root, "no-gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => {
    child.kill();
  }, 60_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { code, output: stdout + stderr };
}

const checks: [string, string, (result: { code: number; output: string }) => boolean][] = [
  ["a vault note stays closed", `cat '${join(vault, "Life.md")}'`, (result) => result.code !== 0],
  ["Eva's secrets stay closed", `cat '${join(instance, "secrets.json")}'`, (result) => result.code !== 0],
  [
    "pi's chat histories stay closed",
    `cat '${join(instance, "engines", "pi-agent", "sessions", "chat.jsonl")}'`,
    (result) => result.code !== 0,
  ],
  ["another clone stays closed", `cat '${join(otherClone, "other.txt")}'`, (result) => result.code !== 0],
  [
    "the project's notes stay readable",
    `cat '${join(project, "plan.md")}'`,
    (result) => result.output.includes("plan"),
  ],
  ["the project's notes stay read-only", `echo x >> '${join(project, "plan.md")}'`, (result) => result.code !== 0],
  [
    "the chat's folder is writable",
    "echo hello > note.txt && cat note.txt",
    (result) => result.output.includes("hello"),
  ],
  [
    "a git commit works in the chat's folder",
    "echo x > a.txt && git add a.txt && git -c user.name=Demo -c user.email=demo@example.com commit -q -m second && git log --oneline | wc -l",
    (result) => result.output.trim().endsWith("2"),
  ],
  ["a hook of the clone stays read-only", "echo x > .git/hooks/pre-commit", (r) => r.code !== 0],
  ["a temporary file works", 'f=$(mktemp) && echo temp > "$f" && cat "$f"', (result) => result.output.includes("temp")],
  [
    "npm's registry is reachable",
    "curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/",
    (result) => result.output.startsWith("200"),
  ],
  [
    "a site that no rule names is refused",
    "curl -s -o /dev/null -w '%{http_code}' https://example.com/",
    (result) => !result.output.startsWith("200"),
  ],
];

let failed = 0;
for (const [name, command, passes] of checks) {
  const result = await run(command);
  const ok = passes(result);
  if (!ok) failed += 1;
  console.log(
    `${ok ? "[ok]  " : "[FAIL]"} ${name}${ok ? "" : `: exit ${String(result.code)}, ${result.output.trim()}`}`,
  );
}
const missing = await run("true");
writeFileSync(wallFile, "not json");
const broken = await run("echo MARKER-OF-A-RUN");
const closed = broken.code === 126 && !broken.output.includes("MARKER-OF-A-RUN");
if (!closed) failed += 1;
console.log(`${closed ? "[ok]  " : "[FAIL]"} a broken wall file runs nothing`);
console.log(`The wrapper with a working wall ended with ${String(missing.code)}.`);
rmSync(root, { recursive: true, force: true });
if (failed > 0) {
  console.log(`${String(failed)} checks failed.`);
  process.exit(1);
}
console.log("Every check passed.");
