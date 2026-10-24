/**
 * The sync of each repository of a clone with its remote, for the clone cards: how far it is
 * ahead or behind, a fetch, a pull, and a commit of every change with a push.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import { githubCredentialArguments } from "../vault/vault-clone.ts";
import type { CloneRepository, SyncState } from "./clones.ts";

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
export async function readSyncState(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<SyncState> {
  try {
    const counts = await git(repository, runner, environment, [
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...@{upstream}",
    ]);
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    if (counts.exitCode !== 0 || !Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind))
      return { ahead: null, behind: null };
    return { ahead: ahead ?? null, behind: behind ?? null };
  } catch {
    return { ahead: null, behind: null };
  }
}

/** Fetches the remote of the repository. Null when it worked, or git's reason. */
export async function fetchClone(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<string | null> {
  try {
    const result = await git(
      repository,
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
export async function pullClone(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<void> {
  const result = await git(
    repository,
    runner,
    environment,
    [...githubCredentialArguments, ...noHooks(), "pull", "-q", "--ff-only", "--no-rebase"],
    networkTimeoutMs,
  );
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not pull ${repository.name}: ${failureReason(result, "git")}`);
}

/**
 * True when the repository holds work that no remote has: a change, a new file, a stash, or a
 * commit that no remote branch holds. Any doubt counts as work, so a reuse never loses it.
 * A folder that is not the top of its own repository counts too: git would read a repository
 * above it, such as the vault (issue 502).
 */
export async function hasLocalWork(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<boolean> {
  try {
    const top = await git(repository, runner, environment, ["rev-parse", "--show-cdup"]);
    if (top.exitCode !== 0 || top.stdout.trim() !== "") return true;
    const status = await git(repository, runner, environment, [
      "--no-optional-locks",
      "status",
      "--porcelain",
      "--untracked-files=normal",
    ]);
    if (status.exitCode !== 0 || status.stdout.trim() !== "") return true;
    const stash = await git(repository, runner, environment, ["stash", "list"]);
    if (stash.exitCode !== 0 || stash.stdout.trim() !== "") return true;
    // HEAD too, for a commit on a detached head.
    const unpushed = await git(repository, runner, environment, [
      "rev-list",
      "--count",
      "HEAD",
      "--branches",
      "--not",
      "--remotes",
    ]);
    return unpushed.exitCode !== 0 || unpushed.stdout.trim() !== "0";
  } catch {
    return true;
  }
}

/**
 * Puts the repository on its default branch, as the remote has it now, for a new chat. Call it only
 * when `hasLocalWork` is false: the old branch stays on the remote. Ignored files, such as the
 * installed dependencies, stay.
 */
export async function resetToDefaultBranch(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<void> {
  const network = async (arguments_: readonly string[], what: string): Promise<void> => {
    const result = await git(
      repository,
      runner,
      environment,
      [...githubCredentialArguments, ...noHooks(), ...arguments_],
      networkTimeoutMs,
    );
    if (result.exitCode !== 0)
      throw new EvaError("git_failed", `Could not ${what} ${repository.name}: ${failureReason(result, "git")}`);
  };
  await network(["fetch", "-q", "--no-tags", "origin"], "fetch");
  const readDefault = async (): Promise<string | null> => {
    const result = await git(repository, runner, environment, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    const name = result.stdout.trim();
    return result.exitCode === 0 && name.startsWith("origin/") ? name.slice("origin/".length) : null;
  };
  let branch = await readDefault();
  if (branch === null) {
    await network(["remote", "set-head", "origin", "--auto"], "find the default branch of");
    branch = await readDefault();
  }
  if (branch === null) throw new EvaError("git_failed", `Could not find the default branch of ${repository.name}.`);
  await mustRun(
    repository,
    runner,
    environment,
    [...noHooks(), "checkout", "-q", "-B", branch, `origin/${branch}`],
    "switch to the default branch of",
  );
}
/**
 * Commits every change with the message, then pushes the branch to the branch of the same name on
 * `origin`, which becomes its upstream. With no change, it pushes the commits that are there.
 */
export async function commitAndPush(
  repository: CloneRepository,
  message: string,
  runner: ProcessRunner,
  environment: Environment,
): Promise<void> {
  if (usesLfs(repository)) {
    throw new EvaError(
      "git_failed",
      `${repository.name} uses Git LFS, whose upload needs a hook that Eva does not run. Push it from a chat.`,
    );
  }
  const files = await changedFiles(repository, runner, environment);
  if (files.length > 0) {
    await mustRun(repository, runner, environment, ["add", "-A"], "stage the changes of");
    // A machine with no git identity yet still commits, as the vault's first commit does.
    const email = await git(repository, runner, environment, ["config", "user.email"]);
    const fallback =
      environment["GIT_AUTHOR_EMAIL"] === undefined && email.stdout.trim() === ""
        ? ["-c", "user.name=Eva", "-c", "user.email=eva@localhost"]
        : [];
    await mustRun(
      repository,
      runner,
      environment,
      [...noHooks(), ...fallback, "commit", "-q", "--no-verify", "-F", "-"],
      "commit in",
      message.trim().length > 0 ? message : fallbackCommitMessage(files),
    );
  }
  const branch = await git(repository, runner, environment, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.exitCode !== 0 || branch.stdout.trim() === "HEAD")
    throw new EvaError("git_failed", `${repository.name} is on no branch, so Eva cannot push it.`);
  const remoteBranch = await git(repository, runner, environment, [
    "rev-parse",
    "--verify",
    "-q",
    `refs/remotes/origin/${branch.stdout.trim()}`,
  ]);
  const head = await git(repository, runner, environment, ["rev-parse", "HEAD"]);
  if (files.length === 0 && remoteBranch.exitCode === 0 && remoteBranch.stdout.trim() === head.stdout.trim()) {
    throw new EvaError("git_failed", `${repository.name} has nothing to push.`);
  }
  // `HEAD` names the branch of the same name, so a branch that tracks main never lands on main.
  const result = await git(
    repository,
    runner,
    environment,
    [...githubCredentialArguments, ...noHooks(), "push", "-q", "--no-verify", "-u", "origin", "HEAD"],
    networkTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw new EvaError(
      "git_failed",
      `Could not push ${repository.name}. The commit stays in the clone. ${failureReason(result, "git")}`,
    );
  }
}

/** Git LFS uploads its files in a pre-push hook, and Eva's push runs no hook. */
function usesLfs(repository: CloneRepository): boolean {
  try {
    return /\bfilter=lfs\b/.test(readFileSync(join(repository.path, ".gitattributes"), "utf8"));
  } catch {
    return false;
  }
}

/** The changes that a commit would hold, for a model that writes its message. */
export async function describeChanges(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<ChangeDescription> {
  const entries = await statusEntries(repository, runner, environment);
  const tracked = await git(repository, runner, environment, ["--no-optional-locks", "diff", "HEAD", "--no-color"]);
  const parts = [tracked.exitCode === 0 ? tracked.stdout : ""];
  for (const entry of entries.filter((each) => each.untracked)) {
    parts.push(`New file ${entry.path}:\n${newFileStart(join(repository.path, entry.path))}\n`);
  }
  const diff = parts.join("\n");
  const log = await git(repository, runner, environment, ["log", `-${String(recentCommitCount)}`, "--format=%s"]);
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

/** The changed, staged and new files of a repository. */
export async function changedFiles(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<string[]> {
  return (await statusEntries(repository, runner, environment)).map((entry) => entry.path);
}

interface StatusEntry {
  readonly path: string;
  readonly untracked: boolean;
}

async function statusEntries(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
): Promise<StatusEntry[]> {
  // No index refresh, so no index.lock: a timeout kill would leave the lock (lesson 81).
  const result = await git(repository, runner, environment, [
    "--no-optional-locks",
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
  ]);
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not read ${repository.name}: ${failureReason(result, "git")}`);
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
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
  arguments_: readonly string[],
  what: string,
  stdin?: string,
): Promise<void> {
  const result = await git(repository, runner, environment, arguments_, localTimeoutMs, stdin);
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not ${what} ${repository.name}: ${failureReason(result, "git")}`);
}

function git(
  repository: CloneRepository,
  runner: ProcessRunner,
  environment: Environment,
  arguments_: readonly string[],
  timeoutMs = localTimeoutMs,
  stdin?: string,
): ReturnType<ProcessRunner["run"]> {
  return runner.run(["git", ...arguments_], {
    cwd: repository.path,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs,
    ...(stdin === undefined ? {} : { stdin }),
  });
}
