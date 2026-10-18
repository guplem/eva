import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sourceUpdateChannel } from "../../../../src/core/updates/source-update.ts";
import type { UpdateChannel } from "../../../../src/core/updates/updater.ts";
import { systemProcessRunner, type ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

const fakeBun = "fake-bun";
let sandbox: GitSandbox;
let checkout: string;
let other: string;
let installs: string[][];
let installExitCode: number;

/** Real git; `bun install` is faked, so a test never downloads packages. */
const runner: ProcessRunner = {
  run: (command, options) => {
    if (command[0] === fakeBun) {
      installs.push([...command]);
      return Promise.resolve({ exitCode: installExitCode, stdout: "", stderr: "install broke" });
    }
    return systemProcessRunner.run(command, options);
  },
};

function channel(): UpdateChannel {
  return sourceUpdateChannel({ folder: checkout, runner, environment: gitEnvironment, bunExecutable: fakeBun });
}

function pushFromOther(path: string, content: string): string {
  sandbox.write(other, path, content);
  sandbox.git(other, "add", "-A");
  sandbox.git(other, "commit", "-q", "-m", `change ${path}`);
  sandbox.git(other, "push", "-q", "origin", "main");
  return sandbox.git(other, "rev-parse", "--short", "HEAD");
}

async function failure(run: Promise<unknown>): Promise<string> {
  return run.then(
    () => "no failure",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

beforeEach(() => {
  sandbox = createGitSandbox();
  checkout = sandbox.clone("eva");
  other = sandbox.clone("other");
  installs = [];
  installExitCode = 0;
}, gitHookTimeoutMs);
afterEach(() => {
  sandbox.dispose();
}, gitHookTimeoutMs);

describe("source update channel", () => {
  test("an up-to-date checkout has nothing to install", async () => {
    const head = sandbox.git(checkout, "rev-parse", "--short", "HEAD");
    expect(await channel().check()).toEqual({ current: head, latest: head, available: false, releases: null });
    expect(await channel().apply()).toEqual({ current: head, latest: head, available: false, releases: null });
  });

  test("a new commit is found, then fast-forwarded, with no install when the dependencies stay", async () => {
    const before = sandbox.git(checkout, "rev-parse", "--short", "HEAD");
    const latest = pushFromOther("src/new.ts", "export {};\n");
    expect(await channel().check()).toEqual({ current: before, latest, available: true, releases: null });
    expect(await channel().apply()).toEqual({ current: before, latest, available: false, releases: null });
    expect(sandbox.git(checkout, "rev-parse", "--short", "HEAD")).toBe(latest);
    expect(installs).toEqual([]);
  });

  test("git runs with Lefthook off, so the checkout's own hooks never run inside an update", async () => {
    const lefthook: (string | undefined)[] = [];
    const watching: ProcessRunner = {
      run: (command, options) => {
        if (command[0] === "git") lefthook.push(options.environment["LEFTHOOK"]);
        return runner.run(command, options);
      },
    };
    pushFromOther("src/new.ts", "export {};\n");
    await sourceUpdateChannel({
      folder: checkout,
      runner: watching,
      environment: gitEnvironment,
      bunExecutable: fakeBun,
    }).apply();
    expect(lefthook.length).toBeGreaterThan(0);
    expect(lefthook.every((value) => value === "0")).toBe(true);
  });

  test("changed dependencies run a production install when the checkout has no development tools", async () => {
    pushFromOther("package.json", '{ "name": "eva" }\n');
    await channel().apply();
    expect(installs).toEqual([[fakeBun, "install", "--frozen-lockfile", "--ignore-scripts", "--production"]]);
  });

  test("a development checkout keeps its development tools", async () => {
    mkdirSync(join(checkout, "node_modules", "typescript"), { recursive: true });
    pushFromOther("bun.lock", "{}\n");
    await channel().apply();
    expect(installs).toEqual([[fakeBun, "install", "--frozen-lockfile", "--ignore-scripts"]]);
  });

  test("a failed install goes back to the old commit", async () => {
    const before = sandbox.git(checkout, "rev-parse", "--short", "HEAD");
    pushFromOther("package.json", '{ "name": "eva" }\n');
    installExitCode = 1;
    expect(await failure(channel().apply())).toContain(`bun install failed, so Eva went back to ${before}`);
    expect(sandbox.git(checkout, "rev-parse", "--short", "HEAD")).toBe(before);
    expect(installs).toHaveLength(2);
  });

  test("local changes, own commits and a feature branch are never moved", async () => {
    pushFromOther("src/new.ts", "export {};\n");
    sandbox.write(checkout, "AGENTS.md", "# Edited here\n");
    expect(await failure(channel().apply())).toContain("has local changes");
    sandbox.git(checkout, "commit", "-q", "-am", "own commit");
    expect(await failure(channel().apply())).toContain("has its own commits");
    sandbox.git(checkout, "checkout", "-q", "-b", "feature");
    expect(await failure(channel().check())).toContain("is on feature, not on main");
  });

  test("an unreachable repository is a failed check", async () => {
    sandbox.git(checkout, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    expect(await failure(channel().check())).toContain("could not be reached");
  });

  test("a folder that is not a checkout is a failed check", async () => {
    const folder = join(sandbox.root, "plain");
    mkdirSync(folder);
    const plain = sourceUpdateChannel({ folder, runner, environment: gitEnvironment, bunExecutable: fakeBun });
    expect(await failure(plain.check())).toContain("git rev-parse");
  });
});
