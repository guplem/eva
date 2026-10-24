/**
 * Updates for an Eva that runs from a git checkout, such as a server install: a
 * fast-forward to the remote branch, then `bun install` when the dependencies changed. The
 * checkout's commits on `main` passed CI on Ubuntu and Windows before they merged.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessResult, type ProcessRunner } from "../../shared/process-runner.ts";
import { githubCredentialArguments } from "../vault/vault-clone.ts";
import type { UpdateChannel, UpdateCheck } from "./updater.ts";

export interface SourceCheckoutOptions {
  /** The root of Eva's own checkout. */
  readonly folder: string;
  readonly runner: ProcessRunner;
  /** Eva's git environment; its GitHub token reaches a private repository. */
  readonly environment: Readonly<Record<string, string>>;
  readonly bunExecutable: string;
}

const networkTimeoutMs = 120_000;
const localTimeoutMs = 20_000;
const installTimeoutMs = 10 * 60_000;
const dependencyFiles: readonly string[] = ["package.json", "bun.lock"];

export function sourceUpdateChannel(options: SourceCheckoutOptions): UpdateChannel {
  return {
    kind: "source",
    check: () => check(options),
    apply: () => apply(options),
  };
}

async function check(options: SourceCheckoutOptions): Promise<UpdateCheck> {
  const branch = await git(options, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // A development checkout on a feature branch is never moved by an update.
  const defaultBranch = await run(
    options,
    ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    localTimeoutMs,
  );
  const expected = defaultBranch.exitCode === 0 ? defaultBranch.stdout.trim().replace(/^origin\//, "") : "main";
  if (branch !== expected)
    throw new EvaError(
      "update_failed",
      `${options.folder} is on ${branch}, not on ${expected}, so Eva does not update it.`,
    );
  const fetched = await options.runner.run(["git", ...githubCredentialArguments, "fetch", "-q", "origin", branch], {
    cwd: options.folder,
    environment: gitEnvironment(options),
    timeoutMs: networkTimeoutMs,
  });
  if (fetched.exitCode !== 0)
    throw new EvaError("update_failed", `Eva's repository could not be reached: ${failureReason(fetched, "git")}`);
  const behind = await git(options, ["rev-list", "--count", `HEAD..origin/${branch}`]);
  return {
    current: await git(options, ["rev-parse", "--short", "HEAD"]),
    latest: await git(options, ["rev-parse", "--short", `origin/${branch}`]),
    available: behind !== "0",
    releases: null,
  };
}

async function apply(options: SourceCheckoutOptions): Promise<UpdateCheck> {
  const found = await check(options);
  if (!found.available) return found;
  if ((await git(options, ["status", "--porcelain", "--untracked-files=no"])) !== "")
    throw new EvaError("update_failed", `${options.folder} has local changes, so Eva does not update it.`);
  const branch = await git(options, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const merged = await run(options, ["git", "merge", "-q", "--ff-only", `origin/${branch}`], localTimeoutMs);
  if (merged.exitCode !== 0) {
    // A lock file or a timeout also stops the merge, and needs another fix than own commits.
    if ((await git(options, ["rev-list", "--count", `origin/${branch}..HEAD`])) !== "0")
      throw new EvaError("update_failed", `${options.folder} has its own commits. Update it by hand with git pull.`);
    throw new EvaError("update_failed", `git could not move ${options.folder}: ${failureReason(merged, "git")}`);
  }
  const changed = (await git(options, ["diff", "--name-only", found.current, "HEAD"])).split("\n");
  if (changed.some((file) => dependencyFiles.includes(file.trim()))) await install(options, found.current);
  return {
    current: found.current,
    latest: await git(options, ["rev-parse", "--short", "HEAD"]),
    available: false,
    releases: null,
  };
}

/** Installs the new dependencies, or goes back to the old commit when that fails. */
async function install(options: SourceCheckoutOptions, previous: string): Promise<void> {
  // A server install has no development tools (docs/guide/setup.md); keep the same kind of install.
  const production = !existsSync(join(options.folder, "node_modules", "typescript"));
  const command = [
    options.bunExecutable,
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    ...(production ? ["--production"] : []),
  ];
  const installed = await run(options, command, installTimeoutMs);
  if (installed.exitCode === 0) return;
  await run(options, ["git", "reset", "-q", "--hard", previous], localTimeoutMs);
  await run(options, command, installTimeoutMs);
  throw new EvaError(
    "update_failed",
    `bun install failed, so Eva went back to ${previous}: ${failureReason(installed, "bun install")}`,
  );
}

async function git(options: SourceCheckoutOptions, arguments_: readonly string[]): Promise<string> {
  const result = await run(options, ["git", ...arguments_], localTimeoutMs);
  if (result.exitCode !== 0)
    throw new EvaError("update_failed", `git ${arguments_.join(" ")} failed: ${failureReason(result, "git")}`);
  return result.stdout.trim();
}

function run(options: SourceCheckoutOptions, command: readonly string[], timeoutMs: number): Promise<ProcessResult> {
  return options.runner.run(command, { cwd: options.folder, environment: gitEnvironment(options), timeoutMs });
}

function gitEnvironment(options: SourceCheckoutOptions): Record<string, string> {
  // LEFTHOOK=0: the checkout's own git hooks would install and copy files inside the timed merge.
  return { ...options.environment, GIT_TERMINAL_PROMPT: "0", LEFTHOOK: "0" };
}
