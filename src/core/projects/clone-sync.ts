/**
 * The sync of a clone with its remote, for the clone cards: how far it is ahead or behind, a
 * fetch, a pull, and a commit of every change with a push.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import { githubCredentialArguments } from "../vault/vault-clone.ts";
import type { Clone, SyncState } from "./clones.ts";

const localTimeoutMs = 20_000;
const networkTimeoutMs = 2 * 60_000;
/** Enough of the diff for a commit message, and a small model call. */
const diffLimit = 8_000;
/** A new file larger than this shows by name only. */
const newFileLimit = 2_000;
const recentCommitCount = 10;

export interface ChangeDescription {
  /** The changed, staged and new files. */
  readonly files: readonly string[];
  /** The diff against the last commit, with the start of each new file, cut to a limit. */
  readonly diff: string;
  /** The subjects of the last commits, so a new message follows their style. */
  readonly recentSubjects: readonly string[];
}

type Environment = Readonly<Record<string, string>>;

/** The counts against the last fetch. It reads only local refs, so it needs no network. */
export async function readSyncState(clone: Clone, runner: ProcessRunner, environment: Environment): Promise<SyncState> {
  try {
    const counts = await git(clone, runner, environment, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    if (counts.exitCode !== 0 || !Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind))
      return { ahead: null, behind: null };
    return { ahead: ahead ?? null, behind: behind ?? null };
  } catch {
    return { ahead: null, behind: null };
  }
}

/** Fetches the remote of the clone. Null when it worked, or git's reason. */
export async function fetchClone(
  clone: Clone,
  runner: ProcessRunner,
  environment: Environment,
): Promise<string | null> {
  try {
    const result = await git(
      clone,
      runner,
      environment,
      [...githubCredentialArguments, ...noHooks(), "fetch", "-q", "--no-tags"],
      networkTimeoutMs,
    );
    return result.exitCode === 0 ? null : failureReason(result, "git");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A fast-forward pull only: a pull never makes a merge commit or a conflict in the person's clone. */
export async function pullClone(clone: Clone, runner: ProcessRunner, environment: Environment): Promise<void> {
  const result = await git(
    clone,
    runner,
    environment,
    [...githubCredentialArguments, ...noHooks(), "pull", "-q", "--ff-only", "--no-rebase"],
    networkTimeoutMs,
  );
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not pull ${clone.name}: ${failureReason(result, "git")}`);
}

/**
 * Commits every change with the message, then pushes the branch to the branch of the same name on
 * `origin`, which becomes its upstream. With no change, it pushes the commits that are there.
 */
export async function commitAndPush(
  clone: Clone,
  message: string,
  runner: ProcessRunner,
  environment: Environment,
): Promise<void> {
  if (usesLfs(clone)) {
    throw new EvaError(
      "git_failed",
      `${clone.name} uses Git LFS, whose upload needs a hook that Eva does not run. Push it from a chat.`,
    );
  }
  const files = await changedFiles(clone, runner, environment);
  if (files.length > 0) {
    await mustRun(clone, runner, environment, ["add", "-A"], "stage the changes of");
    // A machine with no git identity yet still commits, as the vault's first commit does.
    const email = await git(clone, runner, environment, ["config", "user.email"]);
    const fallback =
      environment["GIT_AUTHOR_EMAIL"] === undefined && email.stdout.trim() === ""
        ? ["-c", "user.name=Eva", "-c", "user.email=eva@localhost"]
        : [];
    await mustRun(
      clone,
      runner,
      environment,
      [...noHooks(), ...fallback, "commit", "-q", "--no-verify", "-F", "-"],
      "commit in",
      message.trim().length > 0 ? message : fallbackCommitMessage(files),
    );
  }
  const branch = await git(clone, runner, environment, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.exitCode !== 0 || branch.stdout.trim() === "HEAD")
    throw new EvaError("git_failed", `${clone.name} is on no branch, so Eva cannot push it.`);
  const remoteBranch = await git(clone, runner, environment, [
    "rev-parse",
    "--verify",
    "-q",
    `refs/remotes/origin/${branch.stdout.trim()}`,
  ]);
  const head = await git(clone, runner, environment, ["rev-parse", "HEAD"]);
  if (files.length === 0 && remoteBranch.exitCode === 0 && remoteBranch.stdout.trim() === head.stdout.trim()) {
    throw new EvaError("git_failed", `${clone.name} has nothing to push.`);
  }
  // `HEAD` names the branch of the same name, so a branch that tracks main never lands on main.
  const result = await git(
    clone,
    runner,
    environment,
    [...githubCredentialArguments, ...noHooks(), "push", "-q", "--no-verify", "-u", "origin", "HEAD"],
    networkTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw new EvaError(
      "git_failed",
      `Could not push ${clone.name}. The commit stays in the clone. ${failureReason(result, "git")}`,
    );
  }
}

/** Git LFS uploads its files in a pre-push hook, and Eva's push runs no hook. */
function usesLfs(clone: Clone): boolean {
  try {
    return /\bfilter=lfs\b/.test(readFileSync(join(clone.path, ".gitattributes"), "utf8"));
  } catch {
    return false;
  }
}

/** The changes that a commit would hold, for a model that writes its message. */
export async function describeChanges(
  clone: Clone,
  runner: ProcessRunner,
  environment: Environment,
): Promise<ChangeDescription> {
  const entries = await statusEntries(clone, runner, environment);
  const tracked = await git(clone, runner, environment, ["--no-optional-locks", "diff", "HEAD", "--no-color"]);
  const parts = [tracked.exitCode === 0 ? tracked.stdout : ""];
  for (const entry of entries.filter((each) => each.untracked)) {
    parts.push(`New file ${entry.path}:\n${newFileStart(join(clone.path, entry.path))}\n`);
  }
  const diff = parts.join("\n");
  const log = await git(clone, runner, environment, ["log", `-${String(recentCommitCount)}`, "--format=%s"]);
  return {
    files: entries.map((entry) => entry.path),
    diff: diff.length > diffLimit ? `${diff.slice(0, diffLimit)}\n…` : diff,
    recentSubjects: log.exitCode === 0 ? log.stdout.split("\n").filter((line) => line.trim().length > 0) : [],
  };
}

/** A plain message for when no model answers: "Update app.ts" or "Update 3 files". */
export function fallbackCommitMessage(files: readonly string[]): string {
  const [only] = files;
  if (files.length === 1 && only !== undefined) return `Update ${only.split("/").at(-1) ?? only}`;
  return files.length === 0 ? "Update files" : `Update ${String(files.length)} files`;
}

/** The changed, staged and new files of a clone. */
export async function changedFiles(clone: Clone, runner: ProcessRunner, environment: Environment): Promise<string[]> {
  return (await statusEntries(clone, runner, environment)).map((entry) => entry.path);
}

interface StatusEntry {
  readonly path: string;
  readonly untracked: boolean;
}

async function statusEntries(clone: Clone, runner: ProcessRunner, environment: Environment): Promise<StatusEntry[]> {
  // No index refresh, so no index.lock: a timeout kill would leave the lock (lesson 81).
  const result = await git(clone, runner, environment, [
    "--no-optional-locks",
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
  ]);
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not read ${clone.name}: ${failureReason(result, "git")}`);
  const fields = result.stdout.split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    entries.push({ path: field.slice(3), untracked: code === "??" });
    // A rename or a copy names its old path in the next field.
    if (/[RC]/.test(code)) index += 1;
  }
  return entries;
}

function newFileStart(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    if (text.includes("\0")) return "(a binary file)";
    return text.length > newFileLimit ? `${text.slice(0, newFileLimit)}\n…` : text;
  } catch {
    return "(Eva cannot read it)";
  }
}

/**
 * A hooks folder that does not exist. Eva's git holds the GitHub token, and the clone's hooks are
 * the repository's code, so they never run in Eva's own commits, pulls and pushes.
 */
function noHooks(): string[] {
  return ["-c", `core.hooksPath=${join(tmpdir(), `eva-no-hooks-${randomUUID()}`)}`];
}

async function mustRun(
  clone: Clone,
  runner: ProcessRunner,
  environment: Environment,
  arguments_: readonly string[],
  what: string,
  stdin?: string,
): Promise<void> {
  const result = await git(clone, runner, environment, arguments_, localTimeoutMs, stdin);
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not ${what} ${clone.name}: ${failureReason(result, "git")}`);
}

function git(
  clone: Clone,
  runner: ProcessRunner,
  environment: Environment,
  arguments_: readonly string[],
  timeoutMs = localTimeoutMs,
  stdin?: string,
): ReturnType<ProcessRunner["run"]> {
  return runner.run(["git", ...arguments_], {
    cwd: clone.path,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs,
    ...(stdin === undefined ? {} : { stdin }),
  });
}
