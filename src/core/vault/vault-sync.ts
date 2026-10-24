/**
 * Eva keeps the vault in sync in her own code: pull before an
 * Assistant turn, commit and push after it, and an idle sweep. Nothing here ever
 * discards a change; a conflict stops the pushes and asks a person.
 */
import { existsSync, lstatSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { Logger } from "../../shared/logger.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import { isEvaError } from "../../shared/errors.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { scratchFolderName } from "../files/vault-files.ts";

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

/** "both" keeps this machine's version at the path and the other version in a copy beside it. */
export type ConflictChoice = "mine" | "theirs" | "both";

/**
 * "committed": commits here and on the remote change the same lines. "uncommitted": an edit
 * that was not committed yet clashes with the remote, and the file holds conflict markers.
 */
export type ConflictKind = "committed" | "uncommitted";

export interface ConflictSummary {
  readonly path: string;
  readonly kind: ConflictKind;
  /** A committed conflict waits until every note has a pick. */
  readonly picked: ConflictChoice | null;
}

export interface VaultConflict extends ConflictSummary {
  /** The text of each version, so the person can compare them. Null: that side deleted the note, or it is not short text. */
  readonly mine: string | null;
  readonly theirs: string | null;
}

export interface VaultConflictReport {
  readonly state: VaultSyncState;
  readonly conflicts: readonly VaultConflict[];
}

/** The answer to a pick has no texts: each text costs git processes, and a tap must answer fast. */
export interface ConflictResolution {
  readonly state: VaultSyncState;
  readonly conflicts: readonly ConflictSummary[];
  /** False when the note had no conflict: nothing changed. */
  readonly found: boolean;
}

export interface VaultSyncOptions {
  readonly vaultPath: string;
  readonly runner: ProcessRunner;
  /** The environment of every git process; Eva adds GIT_TERMINAL_PROMPT=0. */
  readonly environment: Readonly<Record<string, string>>;
  readonly now: () => Date;
  readonly logger?: Logger;
  /** Hides secrets in `lastError`: git names the remote, and a remote address can hold a token. */
  readonly redact?: (text: string) => string;
}

const networkTimeoutMs = 60_000;
const localTimeoutMs = 20_000;
/** The git commands that write a commit, and so need a name and an email. */
const committingCommands = new Set(["commit", "commit-tree", "merge", "rebase", "stash"]);
/** The same identity as the first commit of a new vault (vault-template.ts). */
const evaIdentity: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Eva",
  GIT_AUTHOR_EMAIL: "eva@localhost",
  GIT_COMMITTER_NAME: "Eva",
  GIT_COMMITTER_EMAIL: "eva@localhost",
};
const maxPushAttempts = 3;
/** Files bigger than this are not scanned for secrets: binaries, archives, exports. */
const maxScannedFileBytes = 1_000_000;
/** GitHub refuses a push with a file over 100 MB, and then every later push fails too. */
const maxCommittedFileBytes = 50 * 1024 * 1024;
/** A note conflict shows each version only up to this size: the page compares them line by line. */
const maxComparedTextBytes = 200_000;
/** The `git status --porcelain` codes of a path with a merge conflict. */
const unmergedCodes: ReadonlySet<string> = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
/** An index.lock older than this is left over from a git that was stopped (#505). */
const staleIndexLockMs = 30 * 60_000;
/**
 * Paths go on stdin, never on the command line: Windows limits a command line to 32,767
 * characters, so a save of some hundred files would fail each time (#505). With
 * --pathspec-file-nul, git reads each path as it is, with no quoting.
 */
const pathsOnStdin: readonly string[] = ["--pathspec-from-file=-", "--pathspec-file-nul"];

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface StatusEntry {
  readonly code: string;
  readonly path: string;
  /** The old path of a rename or copy that is staged already, such as after `git mv`. */
  readonly isStagedSource?: boolean;
}

interface Version {
  readonly mode: string;
  readonly oid: string;
}

/** A conflicted path and its two versions; null where that side deleted the file. */
interface ConflictedPath {
  readonly path: string;
  readonly mine: Version | null;
  readonly theirs: Version | null;
}

type ListedConflict = ConflictSummary & ConflictedPath;

/** The result of merging the remote into HEAD: the merged tree, and the paths that conflict. */
interface MergePlan {
  readonly tree: string;
  readonly paths: readonly ConflictedPath[];
}

export class VaultSync {
  private readonly options: VaultSyncOptions;
  private queue: Promise<unknown>;
  private state: VaultSyncState;
  private hasIdentity: boolean;
  /** The pulls that reached the remote. A pull that skips its fetch still ends "ok", so "ok" alone proves no fetch. */
  private pullsThatFetched: number;
  /**
   * The picks of a committed conflict, by path, with the versions at the time of the pick, until
   * every note has one. Memory is enough: a restart loses only these picks, and git still holds
   * every version.
   */
  private readonly picks: Map<string, { choice: ConflictChoice; versions: ConflictedPath }>;

  constructor(options: VaultSyncOptions) {
    this.options = options;
    this.queue = Promise.resolve();
    this.state = { status: "ok", lastCommitAt: null, lastPushAt: null, lastError: null, withheldFiles: [] };
    this.picks = new Map();
    this.hasIdentity = false;
    this.pullsThatFetched = 0;
  }

  get currentState(): VaultSyncState {
    return this.state;
  }

  get fetchedPulls(): number {
    return this.pullsThatFetched;
  }

  /** Brings the remote's commits in, before an Assistant turn. Local edits survive (autostash). */
  pull(): Promise<VaultSyncState> {
    return this.serialize(async () => {
      const branch = await this.checkedDefaultBranch();
      if (branch === null) return this.state;
      const unmerged = unmergedPaths(await this.statusEntries());
      if (unmerged.length > 0) return this.reportConflictMarkers(unmerged);
      // A merge has no autostash, so an edit that is not committed could block it. The next
      // save commits that edit first, then merges.
      if (await this.hasUnpushedMerge(branch)) return this.state;
      const fetched = await this.git(["fetch", "-q", "origin", branch], networkTimeoutMs);
      if (fetched.exitCode !== 0)
        return this.update({ status: "offline", lastError: `Could not reach the remote: ${firstLine(fetched)}` });
      this.pullsThatFetched += 1;
      await this.rebaseOnto(branch, { canMerge: false });
      return this.state;
    });
  }

  /** Commits every change, then pushes. Called after each Assistant turn and by the idle sweep. */
  save(): Promise<VaultSyncState> {
    return this.serialize(async () => {
      const branch = await this.checkedDefaultBranch();
      if (branch === null) return this.state;
      return this.commitAndPush(branch);
    });
  }

  /** The notes that conflict now, from git itself, so the list survives a restart. */
  conflicts(): Promise<VaultConflictReport> {
    return this.serialize(async () => {
      const conflicts: VaultConflict[] = [];
      for (const { mine, theirs, ...summary } of await this.listConflicts()) {
        conflicts.push({ ...summary, mine: await this.versionText(mine), theirs: await this.versionText(theirs) });
      }
      return { state: this.state, conflicts };
    });
  }

  /**
   * Applies a person's pick for one note. After the last note, Eva commits the result and pushes.
   * Git keeps both versions: a committed conflict ends in a merge commit with both parents, and an
   * uncommitted edit stays in the stash.
   */
  resolve(path: string, choice: ConflictChoice): Promise<ConflictResolution> {
    return this.serialize(async () => {
      const found = await this.applyPick(path, choice);
      const conflicts = (await this.listConflicts()).map(({ path: notePath, kind, picked }) => ({
        path: notePath,
        kind,
        picked,
      }));
      return { state: this.state, conflicts, found };
    });
  }

  private async commitAndPush(branch: string): Promise<VaultSyncState> {
    const entries = await this.statusEntries();
    const committed = await this.commitChanges(entries);
    if (!committed) return this.state;
    // A rebase needs a clean index, so the other notes stay committed here until a person picks a version.
    const unmerged = unmergedPaths(entries);
    if (unmerged.length > 0) return this.reportConflictMarkers(unmerged);
    await this.pushWithRetry(branch);
    return this.state;
  }

  /** Each conflicted note with the git objects of its two versions. */
  private async listConflicts(): Promise<ListedConflict[]> {
    const branch = await this.checkedDefaultBranch();
    if (branch === null) return [];
    const unmerged = unmergedPaths(await this.statusEntries());
    if (unmerged.length > 0) {
      const stages = await this.unmergedStages();
      // Stage 3 is this machine's edit, from the stash; stage 2 is the remote's version (see resolveUncommitted).
      return unmerged.map((path) => ({
        path,
        kind: "uncommitted",
        picked: null,
        mine: stages.get(path)?.get("3") ?? null,
        theirs: stages.get(path)?.get("2") ?? null,
      }));
    }
    // A read reports a merge-tree failure only while a conflict is open: a clean vault raises no alert.
    const plan = await this.mergePlan(branch, this.state.status === "conflict");
    if (plan === null) return [];
    this.dropStalePicks(plan);
    return plan.paths.map(({ path, mine, theirs }) => ({
      path,
      kind: "committed",
      picked: this.picks.get(path)?.choice ?? null,
      mine,
      theirs,
    }));
  }

  /** The versions of each unmerged path, by stage. Empty when git fails: the list then shows no text. */
  private async unmergedStages(): Promise<Map<string, Map<string, Version>>> {
    const stages = new Map<string, Map<string, Version>>();
    const listed = await this.git(["ls-files", "-u", "-z"], localTimeoutMs);
    if (listed.exitCode !== 0) return stages;
    for (const { path, stage, version } of parseStageEntries(listed.stdout)) {
      const sides = stages.get(path) ?? new Map<string, Version>();
      sides.set(stage, version);
      stages.set(path, sides);
    }
    return stages;
  }

  /** The text of one version, or null for a deleted, binary or long one: a phone cannot compare those. */
  private async versionText(version: Version | null): Promise<string | null> {
    if (version === null) return null;
    const size = await this.git(["cat-file", "-s", version.oid], localTimeoutMs);
    if (size.exitCode !== 0 || Number(size.stdout.trim()) > maxComparedTextBytes) return null;
    const blob = await this.git(["cat-file", "blob", version.oid], localTimeoutMs);
    if (blob.exitCode !== 0 || blob.stdout.includes("\0")) return null;
    return blob.stdout;
  }

  /** Returns false when the note has no conflict. */
  private async applyPick(path: string, choice: ConflictChoice): Promise<boolean> {
    const branch = await this.checkedDefaultBranch();
    if (branch === null) return false;
    const entries = await this.statusEntries();
    const unmerged = unmergedPaths(entries);
    if (unmerged.length > 0) {
      if (!unmerged.includes(path)) return false;
      if ((await this.resolveUncommitted(path, choice)) && unmerged.length === 1) await this.commitAndPush(branch);
      return true;
    }
    // The edits go into a commit first: the pick then binds to the version that the merge uses,
    // and the fast-forward never meets an edit.
    if (!(await this.commitChanges(entries))) return false;
    const plan = await this.mergePlan(branch);
    const conflicted = plan?.paths.find((entry) => entry.path === path);
    if (plan === null || conflicted === undefined) return false;
    this.picks.set(path, { choice, versions: conflicted });
    this.dropStalePicks(plan);
    if (plan.paths.some((entry) => !this.picks.has(entry.path))) return true;
    if (await this.mergeRemote(branch)) await this.pushWithRetry(branch);
    return true;
  }

  /**
   * Writes the pick into the index and the file. In this state, stage 2 is the remote's version
   * (HEAD after the rebase) and stage 3 is this machine's edit, from the stash.
   */
  private async resolveUncommitted(path: string, choice: ConflictChoice): Promise<boolean> {
    const listed = await this.git(["ls-files", "-u", "-z", "--", path], localTimeoutMs);
    if (listed.exitCode !== 0) return this.failStep("ls-files", listed);
    const stages = new Map(
      parseStageEntries(listed.stdout)
        .filter((entry) => entry.path === path)
        .map((entry) => [entry.stage, entry.version]),
    );
    const entry = { path, mine: stages.get("3") ?? null, theirs: stages.get("2") ?? null };
    // With neither version listed, a pick would delete the note.
    if (entry.mine === null && entry.theirs === null) {
      this.update({ status: "error", lastError: `Git lists no version of ${path}.` });
      return false;
    }
    const written = await this.writePick(entry, choice, "HEAD", {});
    if (written === null) return false;
    for (const removed of written.removed) rmSync(join(this.options.vaultPath, removed), { force: true });
    if (written.kept.length === 0) return true;
    const checkout = await this.git(["checkout", "--", ...written.kept], localTimeoutMs);
    if (checkout.exitCode !== 0) {
      this.update({ status: "error", lastError: `git checkout failed: ${firstLine(checkout)}` });
      return false;
    }
    return true;
  }

  /**
   * Sets the picked version of one path in an index, and the copy for "both". Returns the paths
   * that the index keeps and the paths that it removes, or null when git failed.
   */
  private async writePick(
    entry: ConflictedPath,
    choice: ConflictChoice,
    tree: string,
    environment: Readonly<Record<string, string>>,
  ): Promise<{ kept: string[]; removed: string[] } | null> {
    const keep = choice === "mine" ? entry.mine : choice === "theirs" ? entry.theirs : (entry.mine ?? entry.theirs);
    const kept: string[] = [];
    const removed: string[] = [];
    const steps: string[][] = [];
    if (keep === null) {
      steps.push(["update-index", "--force-remove", "--", entry.path]);
      removed.push(entry.path);
    } else {
      steps.push(["update-index", "--add", "--cacheinfo", keep.mode, keep.oid, entry.path]);
      kept.push(entry.path);
    }
    if (choice === "both" && entry.mine !== null && entry.theirs !== null) {
      const copy = await this.freeCopyPath(entry.path, tree);
      steps.push(["update-index", "--add", "--cacheinfo", entry.theirs.mode, entry.theirs.oid, copy]);
      kept.push(copy);
    }
    for (const step of steps) {
      const result = await this.git(step, localTimeoutMs, environment);
      if (result.exitCode !== 0) {
        this.update({ status: "error", lastError: `git update-index failed: ${firstLine(result)}` });
        return null;
      }
    }
    return { kept, removed };
  }

  /** `Plan (conflict copy).md` beside `Plan.md`, with a number when that name is taken. */
  private async freeCopyPath(path: string, tree: string): Promise<string> {
    const folder = posix.dirname(path);
    const extension = posix.extname(path);
    const stem = posix.basename(path, extension);
    for (let number = 1; ; number += 1) {
      const name = `${stem} (conflict copy${number === 1 ? "" : ` ${String(number)}`})${extension}`;
      const candidate = folder === "." ? name : `${folder}/${name}`;
      const inTree = await this.git(["cat-file", "-e", `${tree}:${candidate}`], localTimeoutMs);
      if (inTree.exitCode !== 0 && !existsSync(join(this.options.vaultPath, candidate))) return candidate;
    }
  }

  /**
   * Merges the remote into HEAD without touching a file until the end: the merge-tree result goes
   * into a temporary index, each conflicted path gets its pick, and a fast-forward moves the
   * worktree. Git refuses that fast-forward when it would overwrite an edit. A missing pick
   * reports the conflict instead.
   */
  private async mergeRemote(branch: string): Promise<boolean> {
    const upToDate = await this.git(["merge-base", "--is-ancestor", `origin/${branch}`, "HEAD"], localTimeoutMs);
    if (upToDate.exitCode === 0) return true;
    const plan = await this.mergePlan(branch);
    if (plan === null) return false;
    // The commit before the merge can hold a newer edit of a picked note.
    this.dropStalePicks(plan);
    if (plan.paths.some((entry) => !this.picks.has(entry.path))) {
      this.reportCommittedConflict(plan);
      return false;
    }
    const indexFile = join(this.options.vaultPath, ".git", "eva-merge-index");
    const environment = { GIT_INDEX_FILE: indexFile };
    rmSync(indexFile, { force: true });
    try {
      if (!(await this.gitStep(["read-tree", plan.tree], environment))) return false;
      for (const entry of plan.paths) {
        if (
          (await this.writePick(entry, this.picks.get(entry.path)?.choice ?? "mine", plan.tree, environment)) === null
        )
          return false;
      }
      const tree = await this.git(["write-tree"], localTimeoutMs, environment);
      if (tree.exitCode !== 0) return this.failStep("write-tree", tree);
      const count = plan.paths.length;
      const message =
        count === 0
          ? "eva: merge the remote"
          : `eva: resolve a conflict (${String(count)} ${count === 1 ? "file" : "files"})`;
      const commit = await this.git(
        ["commit-tree", tree.stdout.trim(), "-p", "HEAD", "-p", `origin/${branch}`, "-m", message],
        localTimeoutMs,
      );
      if (commit.exitCode !== 0) return this.failStep("commit-tree", commit);
      if (!(await this.gitStep(["merge", "--ff-only", "-q", commit.stdout.trim()], {}))) return false;
    } finally {
      rmSync(indexFile, { force: true });
    }
    this.picks.clear();
    this.update({ status: "ok", lastError: null, lastCommitAt: this.options.now() });
    return true;
  }

  /**
   * What a merge of the remote into HEAD gives, from `git merge-tree`, which touches no file.
   * In its output, stage 2 is HEAD (this machine) and stage 3 is the remote.
   */
  private async mergePlan(branch: string, reportFailure = true): Promise<MergePlan | null> {
    const merged = await this.git(
      ["merge-tree", "-z", "--write-tree", "--no-messages", "HEAD", `origin/${branch}`],
      localTimeoutMs,
    );
    if (merged.exitCode !== 0 && merged.exitCode !== 1) {
      if (reportFailure) {
        this.update({
          status: "error",
          lastError: `git merge-tree failed: ${firstLine(merged)}${/unknown option|usage:/i.test(merged.stderr) ? " To resolve a conflict from the phone, Eva needs git 2.38 or newer on this machine." : ""}`,
        });
      }
      return null;
    }
    const [tree = "", ...fields] = merged.stdout.split("\0");
    const byPath = new Map<string, { mine: Version | null; theirs: Version | null }>();
    for (const { path, stage, version } of parseStageEntries(fields.join("\0"))) {
      const sides = byPath.get(path) ?? { mine: null, theirs: null };
      if (stage === "2") sides.mine = version;
      if (stage === "3") sides.theirs = version;
      byPath.set(path, sides);
    }
    return { tree: tree.trim(), paths: [...byPath].map(([path, sides]) => ({ path, ...sides })) };
  }

  /** A pick holds only for the versions at the time of the pick: a newer edit on either side asks again. */
  private dropStalePicks(plan: MergePlan): void {
    for (const [path, { versions }] of this.picks) {
      const current = plan.paths.find((entry) => entry.path === path);
      const same =
        current !== undefined &&
        current.mine?.oid === versions.mine?.oid &&
        current.theirs?.oid === versions.theirs?.oid;
      if (!same) this.picks.delete(path);
    }
  }

  private async gitStep(
    arguments_: readonly string[],
    environment: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    const result = await this.git(arguments_, localTimeoutMs, environment);
    return result.exitCode === 0 || this.failStep(arguments_[0] ?? "", result);
  }

  /** Keeps every line of git's reason: a refused fast-forward names the blocking files on the lines after the first. */
  private failStep(name: string, result: GitResult): false {
    const reason = failureReason(result, "git")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ");
    this.update({ status: "error", lastError: `git ${name} failed: ${reason.slice(0, 500)}` });
    return false;
  }

  private async checkedDefaultBranch(): Promise<string | null> {
    if (this.rebaseInProgress() && !(await this.abortLeftoverRebase())) return null;
    const current = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"], localTimeoutMs)).stdout.trim();
    const defaultBranch = await this.defaultBranch(current);
    if (current !== defaultBranch) {
      // The person may have meant the switch, so the text names both branches and asks, not orders.
      this.update({
        status: "skipped",
        lastError: `Eva syncs ${defaultBranch}, but the vault is on ${current}. If ${defaultBranch} is right, ask the Assistant to switch the vault back to it.`,
      });
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
        lastError: `A rebase is still open in the vault, and git rebase --abort failed: ${firstLine(abort)}`,
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
    let stagedScratch = false;
    for (const { code, path } of entries) {
      if (unmerged.includes(path)) continue;
      if (this.isScratchFile(path)) {
        // An untracked file stays out of a plain commit anyway; a staged one needs --only.
        if (!code.startsWith(" ") && !code.startsWith("?")) stagedScratch = true;
        continue;
      }
      const reason = this.withheldReason(path);
      if (reason === null) kept.push(path);
      else withheld.push({ path, reason });
    }
    this.update({ withheldFiles: withheld });
    if (kept.length === 0) return true;

    // The old path of a staged rename is in neither the folder nor the index, so `git add` refuses
    // it ("did not match any files"). Its removal is staged already; the commit still takes it.
    const stagedSources = new Set(entries.filter((entry) => entry.isStagedSource === true).map((entry) => entry.path));
    const toAdd = kept.filter((path) => !stagedSources.has(path));
    const add =
      toAdd.length === 0 ? null : await this.git(["add", "-A", ...pathsOnStdin], localTimeoutMs, {}, toAdd.join("\0"));
    if (add !== null && add.exitCode !== 0) {
      this.update({ status: "error", lastError: `git add failed: ${failureReason(add, "git")}` });
      return false;
    }
    // A file that was staged and then deleted is gone after the add, and in no commit, so
    // `commit --only` refuses its path ("did not match any file").
    const addedThenDeleted = new Set(entries.filter((entry) => entry.code === "AD").map((entry) => entry.path));
    const committed = kept.filter((path) => !addedThenDeleted.has(path));
    if (committed.length === 0) return true;
    const plural = committed.length === 1 ? "file" : "files";
    // git refuses a full commit while a file has conflict markers, and a pick or a person can stage
    // a withheld or Scratch file: --only commits just the kept files.
    const needsOnly = unmerged.length > 0 || withheld.length > 0 || stagedScratch;
    const onlyKept = needsOnly ? ["--only", ...pathsOnStdin] : [];
    const commit = await this.git(
      // --no-verify: a git hook in the vault must never block an autosave (lesson 27).
      ["commit", "-q", "--no-verify", "-m", `eva: autosave (${String(committed.length)} ${plural})`, ...onlyKept],
      localTimeoutMs,
      {},
      needsOnly ? committed.join("\0") : undefined,
    );
    if (commit.exitCode !== 0) {
      this.update({ status: "error", lastError: `git commit failed: ${failureReason(commit, "git")}` });
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
        this.update({
          status: "offline",
          lastError: `The notes are committed here, but Eva could not reach the remote: ${firstLine(fetched)}`,
        });
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
      pushError = firstLine(pushed);
    }
    this.update({ status: "error", lastError: `The push failed ${String(maxPushAttempts)} times: ${pushError}` });
  }

  /**
   * Rebases on the remote branch. On a conflict it aborts, keeps the local commits, and returns false.
   * When the autostash does not apply again, git can still exit 0: it leaves conflict markers in
   * the files, or keeps the edits only in the stash. Eva reports both as a conflict, and never
   * drops the stash.
   */
  private async rebaseOnto(branch: string, { canMerge } = { canMerge: true }): Promise<boolean> {
    // A rebase drops a merge commit and replays its parents, so a resolved conflict would come back.
    if (await this.hasUnpushedMerge(branch)) return this.mergeRemote(branch);
    const stashesBefore = await this.stashCount();
    const rebase = await this.git(["rebase", "-q", "--autostash", `origin/${branch}`], localTimeoutMs);
    if (rebase.exitCode !== 0) {
      // The conflicted files tell a real conflict from a timeout or a git failure.
      const conflicted = unmergedPaths(await this.statusEntries());
      await this.git(["rebase", "--abort"], localTimeoutMs);
      if (conflicted.length === 0) {
        this.update({ status: "error", lastError: `The rebase on the remote failed: ${firstLine(rebase)}` });
        return false;
      }
      const plan = await this.mergePlan(branch);
      if (plan === null) return false;
      // A rebase replays each commit, so it can stop on a change that a later commit undid.
      // The merge of the two tips is then clean, and the phone would have no note to pick.
      // A pull can hold an edit that is not committed, and a merge has no autostash: the next save merges.
      if (plan.paths.length === 0) return canMerge && (await this.mergeRemote(branch));
      this.reportCommittedConflict(plan);
      return false;
    }
    const unmerged = unmergedPaths(await this.statusEntries());
    if (unmerged.length > 0) {
      this.reportConflictMarkers(unmerged);
      return false;
    }
    if ((await this.stashCount()) > stashesBefore) return this.applyKeptStash();
    this.update({ status: "ok", lastError: null });
    return true;
  }

  /**
   * Older git keeps the edits only in the stash when the autostash does not apply. Eva applies
   * the newest entry, which is that autostash, and never drops it. A clash then shows as
   * conflict markers, which the person resolves from the phone.
   */
  private async applyKeptStash(): Promise<boolean> {
    const applied = await this.git(["stash", "apply", "-q"], localTimeoutMs);
    const unmerged = unmergedPaths(await this.statusEntries());
    if (unmerged.length > 0) {
      this.reportConflictMarkers(unmerged);
      return false;
    }
    // No note conflicts here, so the phone has nothing to pick: this is an error, not a conflict.
    if (applied.exitCode !== 0) {
      this.update({
        status: "error",
        lastError: `Local edits clash with the remote, and git stash apply failed: ${firstLine(applied)} Git keeps the edits in the stash.`,
      });
      return false;
    }
    this.update({ status: "ok", lastError: null });
    return true;
  }

  private reportConflictMarkers(paths: readonly string[]): VaultSyncState {
    return this.update({
      status: "conflict",
      lastError: `These notes have edits here that clash with the remote: ${paths.join(", ")}. Nothing was pushed.`,
    });
  }

  private reportCommittedConflict(plan: MergePlan): VaultSyncState {
    return this.update({
      status: "conflict",
      lastError: `These notes changed here and on the remote: ${plan.paths.map((entry) => entry.path).join(", ")}. The notes are committed here; nothing was pushed.`,
    });
  }

  private async hasUnpushedMerge(branch: string): Promise<boolean> {
    const count = await this.git(["rev-list", "--merges", "--count", `origin/${branch}..HEAD`], localTimeoutMs);
    return count.exitCode === 0 && count.stdout.trim() !== "0";
  }

  private async stashCount(): Promise<number> {
    const list = await this.git(["stash", "list"], localTimeoutMs);
    return list.stdout.split("\n").filter((line) => line.trim().length > 0).length;
  }

  private async hasUnpushedCommits(branch: string): Promise<boolean> {
    const count = await this.git(["rev-list", "--count", `origin/${branch}..HEAD`], localTimeoutMs);
    return count.exitCode !== 0 || count.stdout.trim() !== "0";
  }

  private async defaultBranch(current: string): Promise<string> {
    const known = await this.originHead();
    if (known !== null) return known;
    // A vault made by hand has no origin/HEAD. Only the remote knows its default branch: a guess
    // could sync main on one machine and master on another (#505). Once the answer is stored,
    // this network step never runs again; offline, it fails as the fetch after it would.
    await this.git(["remote", "set-head", "origin", "--auto"], networkTimeoutMs);
    const asked = await this.originHead();
    if (asked !== null) return asked;
    // Offline, the remote's main, then its master. Never the upstream of the current branch: any
    // branch with an upstream would then pass the check.
    for (const candidate of ["main", "master"]) {
      const found = await this.git(["rev-parse", "--verify", "-q", `refs/remotes/origin/${candidate}`], localTimeoutMs);
      if (found.exitCode === 0) return candidate;
    }
    // With no remote, nothing tells main from master, and a skip would ask for a main that does not exist.
    const remote = await this.git(["remote", "get-url", "origin"], localTimeoutMs);
    if (remote.exitCode !== 0 && (current === "main" || current === "master")) return current;
    return "main";
  }

  private async originHead(): Promise<string | null> {
    const head = await this.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], localTimeoutMs);
    const name = head.stdout.trim();
    return head.exitCode === 0 && name.startsWith("origin/") ? name.slice("origin/".length) : null;
  }

  private async statusEntries(): Promise<StatusEntry[]> {
    // No index refresh, so no index.lock: a timeout kill would leave the lock (lesson 81).
    const status = await this.git(
      ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
      localTimeoutMs,
    );
    const fields = status.stdout.split("\0").filter((field) => field.length > 0);
    const entries: StatusEntry[] = [];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index] ?? "";
      const code = field.slice(0, 2);
      entries.push({ code, path: field.slice(3) });
      // A rename or copy entry is followed by its source path, which the commit needs too.
      if (code.startsWith("R") || code.startsWith("C")) {
        index += 1;
        const source = fields[index];
        if (source !== undefined) entries.push({ code, path: source, isStagedSource: true });
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

  /**
   * Scratch holds files received from a chat, such as a bank statement, so it never reaches a
   * commit, whatever the vault's .gitignore says (#415). A removal still commits: it takes an old
   * Scratch file out of the tree. lstat, so a broken link in Scratch is not read as a removal.
   */
  private isScratchFile(relativePath: string): boolean {
    // Windows and macOS ignore the case, so Eva writes into a "scratch" folder that exists already.
    if (relativePath.split("/")[0]?.toLowerCase() !== scratchFolderName.toLowerCase()) return false;
    try {
      lstatSync(join(this.options.vaultPath, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A git that a timeout or a power loss stopped leaves `.git/index.lock` behind (lesson 81).
   * Each later step that writes the index then fails, and /sync cannot fix it from a phone.
   * The age alone tells an old lock from a live one. A person's `git commit` holds the lock while
   * its editor is open, so an editor left open for 30 minutes loses the lock, and that commit fails.
   * The person can commit again. A lock that stays for good stops each sync with no fix from a phone.
   */
  private removeStaleIndexLock(): void {
    const lock = join(this.options.vaultPath, ".git", "index.lock");
    try {
      // The file time comes from the real clock, so the age does too, not from the `now` seam.
      if (Date.now() - statSync(lock).mtimeMs < staleIndexLockMs) return;
      rmSync(lock, { force: true });
      this.options.logger?.log("warn", "Eva removed a stale index.lock from the vault.");
    } catch {
      // No lock, or Windows still holds it open: the git step then reports the problem.
    }
  }

  private rebaseInProgress(): boolean {
    const gitFolder = join(this.options.vaultPath, ".git");
    return pathExists(join(gitFolder, "rebase-merge")) || pathExists(join(gitFolder, "rebase-apply"));
  }

  private async git(
    arguments_: readonly string[],
    timeoutMs: number,
    environment: Readonly<Record<string, string>> = {},
    stdin?: string,
  ): Promise<GitResult> {
    const identity = committingCommands.has(arguments_[0] ?? "") ? await this.identityEnvironment() : {};
    try {
      return await this.options.runner.run(["git", ...arguments_], {
        cwd: this.options.vaultPath,
        ...(stdin === undefined ? {} : { stdin }),
        // Literal pathspecs: a note named "n*.md" must never match "nb.md".
        environment: {
          ...this.options.environment,
          ...identity,
          ...environment,
          GIT_TERMINAL_PROMPT: "0",
          GIT_LITERAL_PATHSPECS: "1",
        },
        timeoutMs,
      });
    } catch (error) {
      const reason = isEvaError(error) ? error.message : String(error);
      return { exitCode: -1, stdout: "", stderr: reason };
    }
  }

  /**
   * A new machine often has no git name or email, and its host name gives git no email to guess,
   * so every commit would fail. Then Eva commits as herself; the person's own identity always wins.
   */
  private async identityEnvironment(): Promise<Readonly<Record<string, string>>> {
    // Only a found identity is kept: one that the person sets later, while Eva runs, then wins.
    if (this.hasIdentity) return {};
    try {
      const result = await this.options.runner.run(["git", "var", "GIT_COMMITTER_IDENT"], {
        cwd: this.options.vaultPath,
        environment: { ...this.options.environment, GIT_TERMINAL_PROMPT: "0" },
        timeoutMs: localTimeoutMs,
      });
      this.hasIdentity = result.exitCode === 0;
    } catch {
      // git could not start: the commit itself then reports the problem.
      return {};
    }
    return this.hasIdentity ? {} : evaIdentity;
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = (): Promise<Result> => {
      this.removeStaleIndexLock();
      return operation();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private update(changes: Partial<VaultSyncState>): VaultSyncState {
    const redact = this.options.redact;
    const lastError = changes.lastError;
    this.state = {
      ...this.state,
      ...changes,
      ...(redact === undefined || lastError === undefined || lastError === null
        ? {}
        : { lastError: redact(lastError) }),
    };
    return this.state;
  }
}

function unmergedPaths(entries: readonly StatusEntry[]): string[] {
  return entries.filter((entry) => unmergedCodes.has(entry.code)).map((entry) => entry.path);
}

/** The `<mode> <oid> <stage>\t<path>` entries of `git ls-files -u -z` and `git merge-tree -z`. */
function parseStageEntries(output: string): { path: string; stage: string; version: Version }[] {
  const entries: { path: string; stage: string; version: Version }[] = [];
  for (const field of output.split("\0")) {
    const match = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(field);
    if (match === null) continue;
    const [, mode = "", oid = "", stage = "", path = ""] = match;
    entries.push({ path, stage, version: { mode, oid } });
  }
  return entries;
}

/** The first line of the reason why a git command failed. It is never empty. */
function firstLine(result: GitResult): string {
  return (
    failureReason(result, "git")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
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
