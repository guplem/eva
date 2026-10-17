/**
 * Eva keeps the vault in sync in her own code: pull before an
 * Assistant turn, commit and push after it, and an idle sweep. Nothing here ever
 * discards a change; a conflict stops the pushes and asks a person.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../../shared/logger.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { isEvaError } from "../../shared/errors.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";

export type VaultSyncStatus = "ok" | "offline" | "conflict" | "error" | "skipped";

/** Why a file stays out of the commit: it looks like a secret, or it is over the size limit. */
export type WithheldReason = "secret" | "too_large";

export interface WithheldFile {
  readonly path: string;
  readonly reason: WithheldReason;
}

export interface VaultSyncState {
  readonly status: VaultSyncStatus;
  readonly lastCommitAt: Date | null;
  readonly lastPushAt: Date | null;
  readonly lastError: string | null;
  /** Files that the last commit left out. */
  readonly withheldFiles: readonly WithheldFile[];
}

export interface VaultSyncOptions {
  readonly vaultPath: string;
  readonly runner: ProcessRunner;
  /** The environment of every git process; Eva adds GIT_TERMINAL_PROMPT=0. */
  readonly environment: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly logger?: Logger;
}

const networkTimeoutMs = 60_000;
const localTimeoutMs = 20_000;
const maxPushAttempts = 3;
/** Files bigger than this are not scanned for secrets: binaries, archives, exports. */
const maxScannedFileBytes = 1_000_000;
/** GitHub refuses a push with a file over 100 MB, and then every later push fails too. */
const maxCommittedFileBytes = 50 * 1024 * 1024;
/** The `git status --porcelain` codes of a path with a merge conflict. */
const unmergedCodes: ReadonlySet<string> = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface StatusEntry {
  readonly code: string;
  readonly path: string;
}

export class VaultSync {
  private readonly options: VaultSyncOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private state: VaultSyncState = {
    status: "ok",
    lastCommitAt: null,
    lastPushAt: null,
    lastError: null,
    withheldFiles: [],
  };

  constructor(options: VaultSyncOptions) {
    this.options = options;
  }

  get currentState(): VaultSyncState {
    return this.state;
  }

  /** Brings the remote's commits in, before an Assistant turn. Local edits survive (autostash). */
  pull(): Promise<VaultSyncState> {
    return this.serialize(async () => {
      const branch = await this.checkedDefaultBranch();
      if (branch === null) return this.state;
      const unmerged = unmergedPaths(await this.statusEntries());
      if (unmerged.length > 0) return this.reportConflictMarkers(unmerged);
      const fetched = await this.git(["fetch", "-q", "origin", branch], networkTimeoutMs);
      if (fetched.exitCode !== 0) return this.update({ status: "offline", lastError: "Could not reach the remote." });
      await this.rebaseOnto(branch);
      return this.state;
    });
  }

  /** Commits every change, then pushes. Called after each Assistant turn and by the idle sweep. */
  save(): Promise<VaultSyncState> {
    return this.serialize(async () => {
      const branch = await this.checkedDefaultBranch();
      if (branch === null) return this.state;
      const entries = await this.statusEntries();
      const committed = await this.commitChanges(entries);
      if (!committed) return this.state;
      // A rebase needs a clean index, so the other notes stay committed here until a person fixes the file.
      const unmerged = unmergedPaths(entries);
      if (unmerged.length > 0) return this.reportConflictMarkers(unmerged);
      await this.pushWithRetry(branch);
      return this.state;
    });
  }

  private async checkedDefaultBranch(): Promise<string | null> {
    if (this.rebaseInProgress() && !(await this.abortLeftoverRebase())) return null;
    const defaultBranch = await this.defaultBranch();
    const current = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"], localTimeoutMs)).stdout.trim();
    if (current !== defaultBranch) {
      this.update({ status: "skipped", lastError: `The vault is on ${current}, not on ${defaultBranch}.` });
      return null;
    }
    return defaultBranch;
  }

  /**
   * Only Eva rebases the vault, so an open rebase is one that a crash or a timeout left behind.
   * An abort resets the tracked files, so Eva refuses when one has an edit (lesson 22).
   */
  private async abortLeftoverRebase(): Promise<boolean> {
    const edited = (await this.statusEntries())
      .filter((entry) => !unmergedCodes.has(entry.code) && "MDT".includes(entry.code[1] ?? " "))
      .map((entry) => entry.path);
    if (edited.length > 0) {
      this.update({
        status: "error",
        lastError: `A rebase is still open in the vault, and these files changed since: ${edited.join(", ")}. Finish or abort it by hand.`,
      });
      return false;
    }
    const abort = await this.git(["rebase", "--abort"], localTimeoutMs);
    if (abort.exitCode !== 0) {
      this.update({
        status: "error",
        lastError: `A rebase is still open in the vault, and git rebase --abort failed: ${firstLine(abort.stderr)}`,
      });
      return false;
    }
    this.options.logger?.log("warn", "Eva aborted a rebase that was left open in the vault.");
    return true;
  }

  /** Returns false when the commit failed; true when it committed or had nothing to commit. */
  private async commitChanges(entries: readonly StatusEntry[]): Promise<boolean> {
    const unmerged = unmergedPaths(entries);
    const withheld: WithheldFile[] = [];
    const kept: string[] = [];
    for (const { path } of entries) {
      if (unmerged.includes(path)) continue;
      const reason = this.withheldReason(path);
      if (reason === null) kept.push(path);
      else withheld.push({ path, reason });
    }
    this.update({ withheldFiles: withheld });
    if (kept.length === 0) return true;

    const add = await this.git(["add", "-A", "--", ...kept], localTimeoutMs);
    if (add.exitCode !== 0) {
      this.update({ status: "error", lastError: `git add failed: ${add.stderr.trim()}` });
      return false;
    }
    const plural = kept.length === 1 ? "file" : "files";
    // git refuses a full commit while a file has conflict markers; --only commits the other files.
    const onlyKept = unmerged.length === 0 ? [] : ["--only", "--", ...kept];
    const commit = await this.git(
      // --no-verify: a git hook in the vault must never block an autosave (lesson 27).
      ["commit", "-q", "--no-verify", "-m", `eva: autosave (${String(kept.length)} ${plural})`, ...onlyKept],
      localTimeoutMs,
    );
    if (commit.exitCode !== 0) {
      this.update({ status: "error", lastError: `git commit failed: ${commit.stderr.trim()}` });
      return false;
    }
    this.update({ lastCommitAt: this.options.now() });
    return true;
  }

  private async pushWithRetry(branch: string): Promise<void> {
    let pushError = "";
    for (let attempt = 1; attempt <= maxPushAttempts; attempt += 1) {
      const fetched = await this.git(["fetch", "-q", "origin", branch], networkTimeoutMs);
      if (fetched.exitCode !== 0) {
        this.update({ status: "offline", lastError: "Could not reach the remote. The notes are committed here." });
        return;
      }
      if (!(await this.rebaseOnto(branch))) return;
      if (!(await this.hasUnpushedCommits(branch))) {
        this.update({ status: "ok", lastError: null });
        return;
      }
      const pushed = await this.git(["push", "-q", "origin", `HEAD:${branch}`], networkTimeoutMs);
      if (pushed.exitCode === 0) {
        this.update({ status: "ok", lastError: null, lastPushAt: this.options.now() });
        return;
      }
      pushError = firstLine(pushed.stderr);
    }
    this.update({ status: "error", lastError: `The push failed ${String(maxPushAttempts)} times: ${pushError}` });
  }

  /**
   * Rebases on the remote branch. On a conflict it aborts, keeps the local commits, and returns false.
   * When the autostash does not apply again, git can still exit 0: it leaves conflict markers in
   * the files, or keeps the edits only in the stash. Eva reports both as a conflict, and never
   * drops the stash.
   */
  private async rebaseOnto(branch: string): Promise<boolean> {
    const stashesBefore = await this.stashCount();
    const rebase = await this.git(["rebase", "-q", "--autostash", `origin/${branch}`], localTimeoutMs);
    if (rebase.exitCode !== 0) {
      // The conflicted files tell a real conflict from a timeout or a git failure.
      const conflicted = unmergedPaths(await this.statusEntries());
      await this.git(["rebase", "--abort"], localTimeoutMs);
      this.update(
        conflicted.length > 0
          ? {
              status: "conflict",
              lastError: "The vault conflicts with the remote. The notes are committed here; nothing was pushed.",
            }
          : { status: "error", lastError: `The rebase on the remote failed: ${firstLine(rebase.stderr)}` },
      );
      return false;
    }
    const unmerged = unmergedPaths(await this.statusEntries());
    if (unmerged.length > 0) {
      this.reportConflictMarkers(unmerged);
      return false;
    }
    if ((await this.stashCount()) > stashesBefore) {
      this.update({
        status: "conflict",
        lastError: "Local edits clash with the remote. Git keeps them in the stash: see git stash list.",
      });
      return false;
    }
    this.update({ status: "ok", lastError: null });
    return true;
  }

  private reportConflictMarkers(paths: readonly string[]): VaultSyncState {
    return this.update({
      status: "conflict",
      lastError: `These files have conflict markers: ${paths.join(", ")}. Fix each file and run git add on it. Nothing was pushed.`,
    });
  }

  private async stashCount(): Promise<number> {
    const list = await this.git(["stash", "list"], localTimeoutMs);
    return list.stdout.split("\n").filter((line) => line.trim().length > 0).length;
  }

  private async hasUnpushedCommits(branch: string): Promise<boolean> {
    const count = await this.git(["rev-list", "--count", `origin/${branch}..HEAD`], localTimeoutMs);
    return count.exitCode !== 0 || count.stdout.trim() !== "0";
  }

  private async defaultBranch(): Promise<string> {
    const head = await this.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], localTimeoutMs);
    const name = head.stdout.trim();
    return head.exitCode === 0 && name.startsWith("origin/") ? name.slice("origin/".length) : "main";
  }

  private async statusEntries(): Promise<StatusEntry[]> {
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], localTimeoutMs);
    const fields = status.stdout.split("\0").filter((field) => field.length > 0);
    const entries: StatusEntry[] = [];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index] ?? "";
      const code = field.slice(0, 2);
      entries.push({ code, path: field.slice(3) });
      // A rename or copy entry is followed by its source path, which must be staged too.
      if (code.startsWith("R") || code.startsWith("C")) {
        index += 1;
        const source = fields[index];
        if (source !== undefined) entries.push({ code, path: source });
      }
    }
    return entries;
  }

  /**
   * A file over the size limit stays out of the commit everywhere. A file outside a project
   * folder that holds a secret stays out too.
   */
  private withheldReason(relativePath: string): WithheldReason | null {
    const absolutePath = join(this.options.vaultPath, relativePath);
    try {
      const info = statSync(absolutePath);
      if (!info.isFile()) return null;
      if (info.size > maxCommittedFileBytes) return "too_large";
      if (relativePath.startsWith("Projects/") || info.size > maxScannedFileBytes) return null;
      return containsSecretPattern(readFileSync(absolutePath, "utf-8")) ? "secret" : null;
    } catch {
      return null;
    }
  }

  private rebaseInProgress(): boolean {
    const gitFolder = join(this.options.vaultPath, ".git");
    return pathExists(join(gitFolder, "rebase-merge")) || pathExists(join(gitFolder, "rebase-apply"));
  }

  private async git(arguments_: readonly string[], timeoutMs: number): Promise<GitResult> {
    try {
      return await this.options.runner.run(["git", ...arguments_], {
        cwd: this.options.vaultPath,
        environment: { ...this.options.environment, GIT_TERMINAL_PROMPT: "0" },
        timeoutMs,
      });
    } catch (error) {
      const reason = isEvaError(error) ? error.message : String(error);
      return { exitCode: -1, stdout: "", stderr: reason };
    }
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private update(changes: Partial<VaultSyncState>): VaultSyncState {
    this.state = { ...this.state, ...changes };
    return this.state;
  }
}

function unmergedPaths(entries: readonly StatusEntry[]): string[] {
  return entries.filter((entry) => unmergedCodes.has(entry.code)).map((entry) => entry.path);
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "git gave no reason."
  );
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
