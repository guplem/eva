/**
 * Eva keeps the vault in sync in her own code (docs/plan.md §6, D7): pull before an
 * Assistant turn, commit and push after it, and an idle sweep. Nothing here ever
 * discards a change; a conflict stops the pushes and asks a person.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { isEvaError } from "../../shared/errors.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";

export type VaultSyncStatus = "ok" | "offline" | "conflict" | "error" | "skipped";

export interface VaultSyncState {
  readonly status: VaultSyncStatus;
  readonly lastCommitAt: Date | null;
  readonly lastPushAt: Date | null;
  readonly lastError: string | null;
  /** Files the secret scan kept out of the last commit. */
  readonly withheldFiles: readonly string[];
}

export interface VaultSyncOptions {
  readonly vaultPath: string;
  readonly runner: ProcessRunner;
  /** The environment of every git process; Eva adds GIT_TERMINAL_PROMPT=0. */
  readonly environment: Readonly<Record<string, string>>;
  readonly now: () => Date;
}

const networkTimeoutMs = 60_000;
const localTimeoutMs = 20_000;
const maxPushAttempts = 3;
/** Files bigger than this are not scanned for secrets: binaries, archives, exports. */
const maxScannedFileBytes = 1_000_000;

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
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
      const committed = await this.commitChanges();
      if (!committed) return this.state;
      await this.pushWithRetry(branch);
      return this.state;
    });
  }

  private async checkedDefaultBranch(): Promise<string | null> {
    if (this.rebaseInProgress()) {
      this.update({ status: "error", lastError: "A rebase is still open in the vault. Finish or abort it by hand." });
      return null;
    }
    const defaultBranch = await this.defaultBranch();
    const current = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"], localTimeoutMs)).stdout.trim();
    if (current !== defaultBranch) {
      this.update({ status: "skipped", lastError: `The vault is on ${current}, not on ${defaultBranch}.` });
      return null;
    }
    return defaultBranch;
  }

  /** Returns false when the commit failed; true when it committed or had nothing to commit. */
  private async commitChanges(): Promise<boolean> {
    const changed = await this.changedPaths();
    const withheld = changed.filter((path) => this.mustWithhold(path));
    const kept = changed.filter((path) => !withheld.includes(path));
    this.update({ withheldFiles: withheld });
    if (kept.length === 0) return true;

    const add = await this.git(["add", "-A", "--", ...kept], localTimeoutMs);
    if (add.exitCode !== 0) {
      this.update({ status: "error", lastError: `git add failed: ${add.stderr.trim()}` });
      return false;
    }
    const plural = kept.length === 1 ? "file" : "files";
    const commit = await this.git(
      ["commit", "-q", "-m", `eva: autosave (${String(kept.length)} ${plural})`],
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
    }
    this.update({ status: "error", lastError: `The push failed ${String(maxPushAttempts)} times.` });
  }

  /** Rebases on the remote branch. On a conflict it aborts, keeps the local commits, and returns false. */
  private async rebaseOnto(branch: string): Promise<boolean> {
    const rebase = await this.git(["rebase", "-q", "--autostash", `origin/${branch}`], localTimeoutMs);
    if (rebase.exitCode === 0) {
      this.update({ status: "ok", lastError: null });
      return true;
    }
    await this.git(["rebase", "--abort"], localTimeoutMs);
    this.update({
      status: "conflict",
      lastError: "The vault conflicts with the remote. The notes are committed here; nothing was pushed.",
    });
    return false;
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

  private async changedPaths(): Promise<string[]> {
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], localTimeoutMs);
    const entries = status.stdout.split("\0").filter((entry) => entry.length > 0);
    const paths: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] ?? "";
      const code = entry.slice(0, 2);
      paths.push(entry.slice(3));
      // A rename or copy entry is followed by its source path, which must be staged too.
      if (code.startsWith("R") || code.startsWith("C")) {
        index += 1;
        const source = entries[index];
        if (source !== undefined) paths.push(source);
      }
    }
    return paths;
  }

  /** A file outside a project folder that holds a secret stays out of the commit (plan §6). */
  private mustWithhold(relativePath: string): boolean {
    if (relativePath.startsWith("Projects/")) return false;
    const absolutePath = join(this.options.vaultPath, relativePath);
    try {
      const info = statSync(absolutePath);
      if (!info.isFile() || info.size > maxScannedFileBytes) return false;
      return containsSecretPattern(readFileSync(absolutePath, "utf-8"));
    } catch {
      return false;
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

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
