/**
 * Snapshots of the files of a clone, so a retry can undo a turn and a fork can start from the files
 * of its message (issue 523). A snapshot is one commit in each repository of the clone, under
 * `refs/eva/snapshots/<id>`. It holds the tracked and the untracked files, never the ignored ones.
 * The index, `HEAD` and the files do not change.
 */
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import { noHooks } from "./clone-sync.ts";
import { listRepositories, type CloneRepository } from "./clones.ts";
import { guardedArguments, guardRepository, type GuardedEnvironment } from "./repository-guard.ts";

export interface SnapshotRun {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
}

/** A run in one repository that passed the guard (#1131). */
interface GuardedRun {
  readonly runner: ProcessRunner;
  readonly environment: GuardedEnvironment;
}

async function guarded(repository: CloneRepository, run: SnapshotRun): Promise<GuardedRun> {
  return { runner: run.runner, environment: await guardRepository(repository, run.runner, run.environment) };
}

const refPrefix = "refs/eva/snapshots/";
/** `git add -A` reads every file, which takes long in a big repository on Windows. */
const timeoutMs = 2 * 60_000;
const branchLine = /^Eva-Branch: (.+)$/m;
/** The id goes into a ref name and a command, so it holds only safe characters. */
const idPattern = /^[\w-]+$/;

/**
 * Takes a snapshot of each repository of the clone. False when the clone has no repository or one
 * snapshot failed: the turn goes on without one. Throws EvaError `repository_refused` when Eva
 * runs no git in one of its repositories, so the chat can say why.
 */
export async function takeSnapshot(clonePath: string, id: string, run: SnapshotRun): Promise<boolean> {
  checkId(id);
  const repositories = listRepositories(clonePath);
  if (repositories.length === 0) return false;
  // Every repository passes the guard first, so a refusal leaves no snapshot in the others.
  const checked = await Promise.all(
    repositories.map(async (repository) => ({ repository, checkedRun: await guarded(repository, run) })),
  );
  const results = await Promise.all(
    checked.map(({ repository, checkedRun }) => snapshotRepository(repository, id, checkedRun)),
  );
  return results.every(Boolean);
}

async function snapshotRepository(repository: CloneRepository, id: string, run: GuardedRun): Promise<boolean> {
  const gitFolder = await git(repository, run, ["rev-parse", "--absolute-git-dir"]);
  if (gitFolder.exitCode !== 0) return false;
  const index = join(gitFolder.stdout.trim(), `eva-snapshot-index-${id}`);
  const withIndex = { ...run, environment: { ...run.environment, GIT_INDEX_FILE: index } };
  try {
    const head = await git(repository, run, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]);
    const parent = head.exitCode === 0 ? head.stdout.trim() : null;
    // A copy of the real index keeps the stat cache, so git reads only the changed files again.
    // With no index yet, the copy starts from the last commit, or empty.
    if (!copyIndex(await git(repository, run, ["rev-parse", "--git-path", "index"]), repository, index)) {
      const read = await git(repository, withIndex, parent === null ? ["read-tree", "--empty"] : ["read-tree", parent]);
      if (read.exitCode !== 0) return false;
    }
    const added = await git(repository, withIndex, ["add", "-A"]);
    if (added.exitCode !== 0) return false;
    const tree = await git(repository, withIndex, ["write-tree"]);
    if (tree.exitCode !== 0) return false;
    const branch = await git(repository, run, ["symbolic-ref", "--short", "-q", "HEAD"]);
    const message = `Eva snapshot ${id}${branch.exitCode === 0 ? `\n\nEva-Branch: ${branch.stdout.trim()}` : ""}`;
    // A fixed identity: the commit never leaves the computer, and a new machine may have none.
    const commit = await git(repository, run, [
      "-c",
      "user.name=Eva",
      "-c",
      "user.email=eva@localhost",
      "commit-tree",
      tree.stdout.trim(),
      ...(parent === null ? [] : ["-p", parent]),
      "-m",
      message,
    ]);
    if (commit.exitCode !== 0) return false;
    const ref = await git(repository, run, ["update-ref", `${refPrefix}${id}`, commit.stdout.trim()]);
    return ref.exitCode === 0;
  } catch {
    return false;
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * Brings back the files, the branch and its commit of a snapshot. Untracked files that came later
 * go, ignored files stay, and a staged change comes back unstaged. A repository without the
 * snapshot stays as it is. Call it only while no turn runs in the clone.
 */
export async function restoreSnapshot(clonePath: string, id: string, run: SnapshotRun): Promise<void> {
  checkId(id);
  const found = await withSnapshot(clonePath, id, run);
  if (found.length === 0)
    throw new EvaError("snapshot_missing", "Eva has no snapshot of the files for this answer any more.");
  for (const repository of found) await restoreRepository(repository, id, run);
}

async function restoreRepository(repository: CloneRepository, id: string, given: SnapshotRun): Promise<void> {
  const run = await guarded(repository, given);
  const ref = `${refPrefix}${id}`;
  const message = await mustRun(repository, run, ["log", "-1", "--format=%B", ref], "read the snapshot of");
  const branch = branchLine.exec(message)?.[1]?.trim() ?? null;
  const parent = await git(repository, run, ["rev-parse", "--verify", "-q", `${ref}^1`]);
  if (parent.exitCode === 0) {
    const commit = parent.stdout.trim();
    await mustRun(
      repository,
      run,
      [...noHooks(), "checkout", "-q", "-f", ...(branch === null ? ["--detach", commit] : ["-B", branch, commit])],
      "go back to the commit of",
    );
  } else {
    // The repository had no commit yet: the branch goes, and every file becomes untracked.
    await mustRun(repository, run, ["read-tree", "--empty"], "empty the index of");
    if (branch !== null) {
      await mustRun(repository, run, ["symbolic-ref", "HEAD", `refs/heads/${branch}`], "go back to the branch of");
      await git(repository, run, ["update-ref", "-d", `refs/heads/${branch}`]);
    }
  }
  // Not `-x`: ignored files, such as dependencies, stay.
  await mustRun(repository, run, ["clean", "-f", "-d", "-q"], "remove the later files of");
  // A snapshot with no file has nothing to bring back, and git refuses a path that matches no file.
  const files = await mustRun(repository, run, ["ls-tree", "--name-only", ref], "read the snapshot of");
  if (files.trim() === "") return;
  await mustRun(repository, run, ["restore", `--source=${ref}`, "--worktree", "--", "."], "restore the files of");
}

/**
 * Fetches a snapshot from each repository of one clone into the repository of the same name in
 * another clone. The refs are not on GitHub, so a new clone gets them from the folder of the old one.
 */
export async function copySnapshot(fromClone: string, toClone: string, id: string, run: SnapshotRun): Promise<void> {
  checkId(id);
  const targets = new Map(listRepositories(toClone).map((repository) => [repository.name, repository]));
  const sources = await withSnapshot(fromClone, id, run);
  if (sources.length === 0)
    throw new EvaError("snapshot_missing", "Eva has no snapshot of the files for this answer any more.");
  for (const source of sources) {
    const target = targets.get(source.name);
    if (target === undefined) continue;
    const ref = `${refPrefix}${id}`;
    // The fetch starts a git in the source repository too, so both pass the guard.
    await guarded(source, run);
    await mustRun(
      target,
      await guarded(target, run),
      [...noHooks(), "fetch", "-q", "--", source.path, `+${ref}:${ref}`],
      "copy the snapshot to",
    );
  }
}

/** Deletes the named snapshots, or every one, in each repository of the clone. A failure leaves only a ref. */
export async function deleteSnapshots(
  clonePath: string,
  ids: readonly string[] | "all",
  given: SnapshotRun,
): Promise<void> {
  if (ids !== "all") for (const id of ids) checkId(id);
  await Promise.all(
    listRepositories(clonePath).map(async (repository) => {
      // A refused repository keeps its refs: a ref left behind costs little.
      const run = await guarded(repository, given).catch(() => null);
      if (run === null) return;
      let refs: string[];
      if (ids === "all") {
        const listed = await git(repository, run, ["for-each-ref", "--format=%(refname)", refPrefix]);
        if (listed.exitCode !== 0) return;
        refs = listed.stdout.split("\n").filter((line) => line.startsWith(refPrefix));
      } else refs = ids.map((id) => `${refPrefix}${id}`);
      if (refs.length === 0) return;
      // One process for every ref: a long chat has two snapshots for each turn.
      const commands = refs.map((ref) => `delete ${ref}\n`).join("");
      await git(repository, run, ["update-ref", "--stdin"], commands);
    }),
  );
}

async function withSnapshot(clonePath: string, id: string, run: SnapshotRun): Promise<CloneRepository[]> {
  const repositories = listRepositories(clonePath);
  const present = await Promise.all(
    repositories.map(
      async (repository) =>
        (
          await git(repository, await guarded(repository, run), [
            "rev-parse",
            "--verify",
            "-q",
            `${refPrefix}${id}^{commit}`,
          ])
        ).exitCode === 0,
    ),
  );
  return repositories.filter((_, index) => present[index]);
}

function checkId(id: string): void {
  if (!idPattern.test(id)) throw new EvaError("snapshot_missing", `A snapshot id cannot hold ${JSON.stringify(id)}.`);
}

async function mustRun(
  repository: CloneRepository,
  run: GuardedRun,
  arguments_: readonly string[],
  what: string,
): Promise<string> {
  const result = await git(repository, run, arguments_);
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `Could not ${what} ${repository.name}: ${failureReason(result, "git")}`);
  return result.stdout;
}

function git(
  repository: CloneRepository,
  run: GuardedRun,
  arguments_: readonly string[],
  stdin?: string,
): ReturnType<ProcessRunner["run"]> {
  return run.runner.run(["git", ...guardedArguments(), ...arguments_], {
    cwd: repository.path,
    environment: { ...run.environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs,
    ...(stdin === undefined ? {} : { stdin }),
  });
}

/** Copies the repository's index to the temporary one. False when there is none to copy. */
function copyIndex(
  found: Awaited<ReturnType<ProcessRunner["run"]>>,
  repository: CloneRepository,
  target: string,
): boolean {
  if (found.exitCode !== 0) return false;
  const source = resolve(repository.path, found.stdout.trim());
  if (!existsSync(source)) return false;
  copyFileSync(source, target);
  return true;
}
