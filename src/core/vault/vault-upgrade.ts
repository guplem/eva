/**
 * The safe steps of a vault upgrade (#773), for the `vault-upgrade` skill: `eva vault-upgrade
 * start|finish|drop|undo`. The skill does the work itself, on a branch in the vault folder. These
 * steps make the backup tag, pause the sync, merge, record the version and go back. Notes that other
 * chats write meanwhile land on the branch, and each step keeps them. A conflict never loses a
 * version: the step keeps both, the other one in a copy beside the file, and names the copy.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { withNewerLocation } from "../location/last-location.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import {
  newestStructureVersion,
  pendingChanges,
  readVaultStructure,
  upgradeBranch,
  upgradeBranchVersion,
  vaultStructurePath,
  writeVaultStructure,
} from "./vault-structure.ts";
import type { GitResult, VaultSync } from "./vault-sync.ts";

export type UpgradeAction = "start" | "finish" | "drop" | "undo";

/** The message of each commit of the notes that other chats wrote during the upgrade. */
const notesMessage = "Notes written during the upgrade";
const upgradeMessage = (version: number | string): string => `Upgrade the vault structure to v${String(version)}`;
const undoMessage = (version: number | string): string => `Undo the vault structure upgrade to v${String(version)}`;

/**
 * The names that the upgrade writes into the vault's git, which a later Eva finds again: the branch
 * pauses the sync, and undo finds its commit by its message. `<N>` is the structure version.
 */
export const upgradeGitNames: readonly string[] = [
  `branch ${upgradeBranch("<N>")}`,
  "tag before-v<N>",
  `commit ${notesMessage}`,
  `commit ${upgradeMessage("<N>")}`,
  `commit ${undoMessage("<N>")}`,
];
const networkTimeoutMs = 60_000;
/** Folders that the inventory leaves out: temporary files, and the clones with their own git. */
const outOfInventory = /^(\.git\/|\.eva\/scratch\/|Scratch\/|Projects\/[^/]+\/repos\/)/;
/** The note whose `lastLocation` the phone keeps writing, so a conflict there keeps the newest point. */
const aboutMePath = "Life/About me.md";
/** The template files that the skill rewrites. An uncommitted change to one is half of the skill's work, never a note. */
const replacedFiles: readonly string[] = ["AGENTS.md", "README.md", ".eva/assistant.md", aboutMePath];
/** The line of the merge commit's body that names the backup tag, so undo finds Eva's copies. */
const backupTagLine = "Backup tag: ";
/** The same limits as the sync: GitHub refuses a file over 100 MB, and a bigger file is not scanned. */
const maxCommittedBytes = 50 * 1024 * 1024;
const maxScannedBytes = 1_000_000;

/** The folder of the upgrade's working files, inside the vault's ignored scratch folder, so the chat can write there freely. */
export function upgradeFolder(vaultPath: string): string {
  return join(vaultPath, ".eva", "scratch", "vault-upgrade");
}

export interface VaultUpgradeOptions {
  readonly vaultPath: string;
  readonly sync: VaultSync;
  readonly isHub: () => boolean;
  /** The `sync.enabled` setting: the backup tag must reach the remote, so a start needs it on. */
  readonly syncEnabled: () => boolean;
  /**
   * `<state>/vault-upgrade/` on this computer: a copy of the inventory, the report and the list of
   * the git-ignored moves, by backup tag. The scratch folder empties after a week, and undo needs them later.
   */
  readonly stateFolder: string;
  /** The folder of the `vault-upgrade` skill, with its template texts. */
  readonly skillFolder: () => string;
  /** Runs what the open branch held back, such as the vault migrations and the location write. */
  readonly afterBranch: () => void;
}

/** One version of a conflicted path, from `git ls-files -u`. */
interface Stage {
  readonly mode: string;
  readonly oid: string;
}

export class VaultUpgrade {
  private readonly options: VaultUpgradeOptions;

  constructor(options: VaultUpgradeOptions) {
    this.options = options;
  }

  /** Runs one command, and returns its report for the chat. Throws `vault_upgrade_refused` with the reason. */
  run(action: UpgradeAction): Promise<string> {
    switch (action) {
      case "start":
        return this.start();
      case "finish":
        return this.finish();
      case "drop":
        return this.drop();
      case "undo":
        return this.undo();
    }
  }

  private async start(): Promise<string> {
    this.requireHub();
    const { vaultPath, sync } = this.options;
    const current = readVaultStructure(vaultPath);
    const target = newestStructureVersion;
    if (target <= current)
      refuse(`The vault follows version ${String(current)}, the newest structure. Nothing changes.`);
    const open = await this.openBranches();
    if (open.length > 0)
      refuse(
        `An upgrade is open on the branch ${open.join(", ")}. Run eva vault-upgrade finish or eva vault-upgrade drop first.`,
      );
    if (!this.options.syncEnabled())
      refuse("Turn on the vault sync first, so the backup reaches your remote. Then try again.");
    assertVaultWritable(vaultPath);
    const record = vaultMigrationRecordPath(vaultPath);
    const missing = pendingChanges(current)
      .flatMap((change) => change.migrations)
      .filter((id) => !migrationApplied(record, id));
    if (missing.length > 0)
      refuse(`These migrations did not run on the vault yet: ${missing.join(", ")}. Restart Eva, then try again.`);
    // The work starts from a saved vault, and the backup tag must reach the remote.
    await sync.pull();
    const saved = await sync.save();
    if (saved.status !== "ok")
      refuse(`Eva could not sync the vault first: ${saved.lastError ?? saved.status}. Fix the sync, then try again.`);
    const tag = await this.freeTag(`before-v${String(target)}`);
    const branch = upgradeBranch(target);
    await sync.exclusive(async () => {
      await this.must(["tag", tag], "make the backup tag");
      const pushed = await this.git(["push", "-q", "origin", `refs/tags/${tag}`], networkTimeoutMs);
      if (pushed.exitCode !== 0) {
        await this.git(["tag", "-d", tag]);
        refuse(`Eva could not push the backup tag ${tag}: ${firstLine(pushed)}. Nothing changed.`);
      }
      await this.must(["switch", "-q", "-c", branch], `create the branch ${branch}`);
      // finish puts the tag in the merge commit, so undo finds Eva's copies of the working files.
      await this.must(["config", `branch.${branch}.evaBackupTag`, tag], "record the backup tag");
    });
    // The sync marks itself paused at once, so the status says so before its next step.
    await sync.pull();
    const folder = upgradeFolder(vaultPath);
    const inventory = await this.writeInventory(target);
    this.keepCopies(target, tag);
    const skill = this.options.skillFolder();
    return [
      `The upgrade to vault structure version ${String(target)} started.`,
      `- Backup tag: ${tag}, on the remote too.`,
      `- Branch: ${branch}, in the vault folder. The sync is paused until finish or drop.`,
      `- Inventory: ${inventory.path} (${inventory.summary}).`,
      `- Write the report to ${join(folder, `v${String(target)}-report.md`)}.`,
      `- Write each git-ignored file that you move to ${ignoredMovesPath(vaultPath, target)}, one "<from>\t<to>" line each.`,
      `- Newest template texts: ${join(skill, "template")}. Every version that Eva shipped: ${join(skill, "shipped")}.`,
    ].join("\n");
  }

  private async finish(): Promise<string> {
    this.requireHub();
    const { vaultPath, sync } = this.options;
    const branch = await this.theOpenBranch();
    const version = upgradeBranchVersion(branch) ?? 0;
    assertVaultWritable(vaultPath);
    const notes = (await this.currentBranch()) === branch ? await this.commitNotes("finish") : [];
    const main = await sync.mainBranch();
    await this.refuseUnsafeFiles(main, branch);
    const tag = (await this.git(["config", `branch.${branch}.evaBackupTag`])).stdout.trim();
    if (tag !== "") this.keepCopies(version, tag);
    await sync.exclusive(() => this.switchTo(main));
    const pulled = await sync.pull();
    if (pulled.status === "conflict" || pulled.status === "error")
      refuse(
        `The pull of ${main} stopped: ${pulled.lastError ?? pulled.status}. Resolve it, then run eva vault-upgrade finish again.`,
      );
    const copies = await sync.exclusive(async () => {
      const start = await this.head();
      const recordBefore = readTextTolerant(vaultStructurePath(vaultPath));
      try {
        const merged = await this.git(["merge", "--no-ff", "--no-commit", "-q", branch]);
        const kept = merged.exitCode === 0 ? [] : await this.keepBoth("incoming", "The merge failed", merged);
        // The record goes into the merge commit, so the version and the change never disagree.
        writeVaultStructure(vaultPath, version);
        await this.must(["add", "--", ".eva/vault-structure.json"], "stage the version record");
        const body = tag === "" ? [] : ["-m", `${backupTagLine}${tag}`];
        await this.must(["commit", "-q", "--no-verify", "-m", upgradeMessage(version), ...body], "commit the merge");
        await this.must(["branch", "-q", "-D", branch], `delete the branch ${branch}`);
        return kept;
      } catch (error) {
        await this.rollBack(start, branch);
        if (recordBefore === null) rmSync(vaultStructurePath(vaultPath), { force: true });
        else writeFileAtomic(vaultStructurePath(vaultPath), recordBefore);
        throw error;
      }
    });
    const saved = await sync.save();
    this.options.afterBranch();
    return [
      `The vault follows structure version ${String(version)} now. ${branch} is merged into ${main}, with the version record.`,
      notesWords(notes),
      copiesWords(copies),
      syncWords(saved.status, saved.lastError),
      "The backup tag stays. To go back, run eva vault-upgrade undo.",
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  private async drop(): Promise<string> {
    const { sync } = this.options;
    const branch = await this.theOpenBranch();
    const version = upgradeBranchVersion(branch) ?? 0;
    const tag = (await this.git(["config", `branch.${branch}.evaBackupTag`])).stdout.trim() || null;
    const onBranch = (await this.currentBranch()) === branch;
    const main = await sync.mainBranch();
    if (onBranch) await this.tidyForDrop(main);
    const before = await this.head();
    const notes = onBranch ? await this.commitNotes("drop") : [];
    // This commit can hold the skill's half work, such as a rewrite of About me that it never committed.
    const lastNotes = notes.length > 0 ? await this.head() : null;
    const modified =
      lastNotes === null || lastNotes === before
        ? []
        : (
            await this.must(
              ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--diff-filter=M", lastNotes],
              "list the changed notes",
            )
          ).stdout
            .split("\0")
            .filter((path) => path !== "");
    const copies = await sync.exclusive(async () => {
      const commits = await this.notesCommits(`${main}..${branch}`);
      if (onBranch) await this.switchForDrop(main);
      const start = await this.head();
      try {
        // A pick finds a moved note again by git's rename detection, so an edit goes back to the old path.
        const kept: string[] = [];
        for (const commit of commits) {
          const picked = await this.git(["cherry-pick", "--no-commit", commit]);
          // The vault stays as it was: the note keeps its old text, and the chat's version goes to a copy.
          if (picked.exitCode !== 0) kept.push(...(await this.keepBoth("here", "The pick failed", picked)));
        }
        // A changed note of the default branch keeps its old text, and the branch's text goes to a copy:
        // Eva cannot tell a chat's edit from the skill's unfinished rewrite.
        if (lastNotes !== null)
          for (const path of modified) {
            const old = await this.versionIn(start, path);
            const changed = await this.versionIn(lastNotes, path);
            if (old === null || changed === null || old.oid === changed.oid) continue;
            await this.place(old, path);
            kept.push(await this.copyOf(path, changed));
          }
        await this.commitIfStaged(notesMessage);
        await this.must(["branch", "-q", "-D", branch], `delete the branch ${branch}`);
        return kept;
      } catch (error) {
        // Back to the start, so the drop can run again.
        await this.rollBack(start, onBranch ? branch : null);
        throw error;
      }
    });
    const back = this.moveIgnoredBack(version, tag);
    const saved = await sync.save();
    this.options.afterBranch();
    return [
      `The upgrade is dropped. The vault is on ${main} as before, with the notes written meanwhile.`,
      notesWords(notes),
      copiesWords(copies),
      back,
      syncWords(saved.status, saved.lastError),
      "The backup tag stays.",
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  private async undo(): Promise<string> {
    this.requireHub();
    const { vaultPath, sync } = this.options;
    const open = await this.openBranches();
    if (open.length > 0)
      refuse(`An upgrade is open on ${open.join(", ")}. Run eva vault-upgrade finish or eva vault-upgrade drop first.`);
    const main = await sync.mainBranch();
    if ((await this.currentBranch()) !== main) refuse(`Switch the vault to ${main} first.`);
    assertVaultWritable(vaultPath);
    const version = readVaultStructure(vaultPath);
    const found = await this.git([
      "log",
      "--first-parent",
      "-1",
      "--format=%H %P%x00%b",
      `--grep=^${upgradeMessage(version)}$`,
      "HEAD",
    ]);
    const [line = "", body = ""] = found.stdout.trim().split("\0");
    const [commit = "", ...parents] = line.trim().split(" ");
    const tag =
      body
        .split("\n")
        .find((each) => each.startsWith(backupTagLine))
        ?.slice(backupTagLine.length)
        .trim() ?? null;
    if (found.exitCode !== 0 || commit === "")
      refuse(`The vault has no upgrade to version ${String(version)} to undo.`);
    await sync.save();
    const changed = (await this.must(["status", "--porcelain", "--untracked-files=no"], "read the status")).stdout;
    if (changed.trim() !== "")
      refuse(`These files have changes that are not committed: ${changed.trim()}. Sync the vault, then try again.`);
    const copies = await sync.exclusive(async () => {
      const start = await this.head();
      try {
        const kept: string[] = [];
        // Each commit of the upgrade goes back on its own, newest first, so a move goes back as a move
        // and an edit made since stays. The notes written during the upgrade stay as they are.
        const own = parents.length > 1 ? await this.upgradeCommits(`${commit}^1..${commit}^2`) : [commit];
        for (const step of own) {
          const reverted = await this.git(["revert", "--no-commit", step]);
          if (reverted.exitCode !== 0) kept.push(...(await this.keepBoth("incoming", "The undo failed", reverted)));
        }
        if (parents.length > 1) await this.restoreFrom(`${commit}^1`, ".eva/vault-structure.json");
        // A removed secret pattern needs the person's yes, and a pattern for both paths does no harm.
        if ((await this.git(["cat-file", "-e", "HEAD:.eva/secret-files"])).exitCode === 0)
          await this.must(["checkout", "HEAD", "--", ".eva/secret-files"], "keep the secret patterns");
        await this.must(["commit", "-q", "--no-verify", "-m", undoMessage(version)], "commit the undo");
        return kept;
      } catch (error) {
        await this.rollBack(start, null);
        throw error;
      }
    });
    const back = this.moveIgnoredBack(version, tag);
    const saved = await sync.save();
    this.options.afterBranch();
    return [
      `The upgrade to version ${String(version)} is undone. The vault is as before it, plus the notes written since. The vault structure card offers the upgrade again.`,
      copiesWords(copies),
      back,
      syncWords(saved.status, saved.lastError),
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  private requireHub(): void {
    if (!this.options.isHub())
      refuse("Only the hub computer upgrades the vault structure. Run this on the hub, or ask in a chat there.");
  }

  /**
   * Commits what other chats wrote on the branch, and returns its files. A chat only writes files, so
   * a staged change or a deleted file is the skill's own work that it did not commit. That stops the
   * step, with its files: committed as notes, a half move would lose the note in a drop or an undo.
   */
  private async commitNotes(step: "finish" | "drop"): Promise<string[]> {
    const { sync } = this.options;
    const status = await this.must(["status", "--porcelain=v1", "-z"], "read the status");
    const entries = status.stdout.split("\0");
    const unfinished: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] ?? "";
      if (entry.length < 4) continue;
      const [staged = " ", worktree = " "] = entry;
      const path = entry.slice(3);
      // A staged rename or copy names its old path in the next field.
      const old = staged === "R" || staged === "C" ? (entries[(index += 1)] ?? "") : "";
      const halfRewrite = step === "finish" && worktree === "M" && replacedFiles.includes(path);
      if ((staged !== " " && staged !== "?") || worktree === "D" || halfRewrite)
        unfinished.push(...[path, old].filter((each) => each !== ""));
    }
    if (unfinished.length > 0)
      refuse(
        `The upgrade branch has work that is not committed: ${unfinished.join(", ")}. Commit each change of the upgrade, with the old and the new path of each move, or put it back. Then run eva vault-upgrade ${step} again.`,
      );
    const before = await this.head();
    if (!(await sync.commitAll(notesMessage)))
      refuse(
        `Eva could not commit the notes written during the upgrade: ${sync.currentState.lastError ?? "unknown reason"}.`,
      );
    if ((await this.head()) === before) return [];
    const listed = await this.git(["show", "--name-only", "-z", "--format=", "HEAD"]);
    return listed.stdout.split("\0").filter((path) => path !== "");
  }

  /**
   * Refuses a merge that would send a secret or a file that is too big: the skill commits with plain
   * git, which skips Eva's secret scan. An encrypted file passes.
   */
  private async refuseUnsafeFiles(main: string, branch: string): Promise<void> {
    const changed = await this.must(
      ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=AM", `${main}...${branch}`],
      "list the files of the upgrade",
    );
    const unsafe: string[] = [];
    for (const path of changed.stdout.split("\0").filter((entry) => entry !== "")) {
      const size = Number((await this.git(["cat-file", "-s", `${branch}:${path}`])).stdout.trim());
      if (size > maxCommittedBytes) {
        unsafe.push(`${path} (too big)`);
        continue;
      }
      if (size > maxScannedBytes) continue;
      const text = (await this.git(["show", `${branch}:${path}`])).stdout;
      if (this.options.sync.isPlainSecret(path, new TextEncoder().encode(text)) || containsSecretPattern(text))
        unsafe.push(path);
    }
    if (unsafe.length > 0)
      refuse(
        `These files of the upgrade hold a secret in plain text, or are too big: ${unsafe.join(", ")}. Nothing changed. Take each one out of the branch, or put the secret in an encrypted file, then run eva vault-upgrade finish again.`,
      );
  }

  /**
   * Resolves each conflicted path of a merge, a pick or a revert, and loses no version: the path
   * takes the `prefer` side, and the other one goes to a copy beside it. About me also takes the
   * newest location of the two. Returns the copies. With no conflicted path, the step failed for
   * another reason, such as a local file in the way, and this refuses with git's reason and files.
   */
  private async keepBoth(prefer: "incoming" | "here", reason: string, failed: GitResult): Promise<string[]> {
    const listed = await this.git(["ls-files", "-u", "-z"]);
    const stages = new Map<string, Map<string, Stage>>();
    for (const entry of listed.stdout.split("\0")) {
      const match = /^(\d+) ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry);
      if (match === null) continue;
      const [, mode = "", oid = "", stage = "", path = ""] = match;
      const sides = stages.get(path) ?? new Map<string, Stage>();
      sides.set(stage, { mode, oid });
      stages.set(path, sides);
    }
    if (stages.size === 0) refuse(`${reason}: ${gitReason(failed)}. Nothing changed.`);
    const copies: string[] = [];
    for (const [path, sides] of stages) {
      const incoming = sides.get("3") ?? null;
      const here = sides.get("2") ?? null;
      const kept = (prefer === "incoming" ? incoming : here) ?? incoming ?? here;
      const other = kept === incoming ? here : incoming;
      if (kept === null) {
        await this.must(["rm", "-q", "--cached", "--ignore-unmatch", "--", path], `resolve ${path}`);
        continue;
      }
      if (path === aboutMePath && other !== null) {
        const [keptText, otherText] = [await this.blob(kept), await this.blob(other)];
        writeFileSync(join(this.options.vaultPath, path), withNewerLocation(keptText, otherText));
        await this.must(["add", "--", path], `resolve ${path}`);
        // The phone's point alone is no reason for a copy. Any other difference is.
        if (withoutLocation(keptText) !== withoutLocation(otherText)) copies.push(await this.copyOf(path, other));
        continue;
      }
      await this.place(kept, path);
      if (other !== null && other.oid !== kept.oid) copies.push(await this.copyOf(path, other));
    }
    return copies;
  }

  /** Writes a version beside its path, as a conflict copy, and returns the copy's path. */
  private async copyOf(path: string, version: Stage): Promise<string> {
    const copy = await this.freeCopyPath(path);
    await this.place(version, copy);
    return copy;
  }

  /** Puts one version at a path, in the index and in the folder. */
  private async place(version: Stage, path: string): Promise<void> {
    await this.must(
      ["update-index", "--add", "--cacheinfo", `${version.mode},${version.oid},${path}`],
      `resolve ${path}`,
    );
    await this.must(["checkout", "--", path], `write ${path}`);
  }

  private async blob(version: Stage): Promise<string> {
    return (await this.must(["cat-file", "blob", version.oid], "read a version")).stdout;
  }

  /** `Plan (conflict copy).md` beside `Plan.md`, with a number when that name is taken. */
  private async freeCopyPath(path: string): Promise<string> {
    const folder = posix.dirname(path);
    const extension = posix.extname(path);
    const stem = posix.basename(path, extension);
    for (let number = 1; ; number += 1) {
      const name = `${stem} (conflict copy${number === 1 ? "" : ` ${String(number)}`})${extension}`;
      const candidate = folder === "." ? name : `${folder}/${name}`;
      const known = await this.git(["ls-files", "--error-unmatch", "--", candidate]);
      if (known.exitCode !== 0 && !existsSync(join(this.options.vaultPath, candidate))) return candidate;
    }
  }

  /** Back to `start` after a failed step: no half merge, pick or revert stays. Then back to `branch`, when given. */
  private async rollBack(start: string, branch: string | null): Promise<void> {
    await this.git(["merge", "--abort"]);
    await this.git(["reset", "-q", "--merge", start]);
    if (branch !== null) await this.git(["switch", "-q", branch]);
  }

  private async commitIfStaged(message: string): Promise<void> {
    if ((await this.git(["diff", "--cached", "--quiet"])).exitCode === 0) return;
    await this.must(["commit", "-q", "--no-verify", "-m", message], "commit");
  }

  /** Sets a path to its version in a commit, or removes it when that commit has none. */
  private async restoreFrom(commit: string, path: string): Promise<void> {
    if ((await this.git(["cat-file", "-e", `${commit}:${path}`])).exitCode === 0)
      await this.must(["checkout", commit, "--", path], `restore ${path}`);
    else await this.must(["rm", "-q", "-f", "--ignore-unmatch", "--", path], `remove ${path}`);
  }

  /** The skill's own commits of a merged upgrade, newest first: no merge and no notes commit. */
  private async upgradeCommits(range: string): Promise<string[]> {
    const listed = await this.must(["log", "--no-merges", "--format=%H%x09%s", range], "list the upgrade's commits");
    return listed.stdout
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(([hash = "", subject]) => hash !== "" && subject !== notesMessage)
      .map(([hash = ""]) => hash);
  }

  /**
   * Keeps Eva's copy of the working files of an upgrade on this computer, by backup tag: the scratch
   * folder empties after a week, and undo needs the list of the git-ignored moves later.
   */
  private keepCopies(version: number, tag: string): void {
    const folder = join(this.options.stateFolder, tag);
    try {
      mkdirSync(folder, { recursive: true });
      for (const path of workingFiles(this.options.vaultPath, version)) {
        const text = readTextTolerant(path);
        if (text !== null) writeFileAtomic(join(folder, basename(path)), text);
      }
    } catch {
      // The scratch folder still holds them, and undo names what it cannot find.
    }
  }

  /**
   * Moves each git-ignored file back to its old place, from the list that the skill wrote, or Eva's
   * copy of it. A file that cannot go back is named, so the person can move it. With no list, the
   * inventory names the git-ignored files that are no longer at their place.
   */
  private moveIgnoredBack(version: number, tag: string | null): string {
    const { vaultPath, stateFolder } = this.options;
    const name = basename(ignoredMovesPath(vaultPath, version));
    const kept = tag === null ? null : join(stateFolder, tag, name);
    const listPath = [ignoredMovesPath(vaultPath, version), kept].find(
      (path): path is string => path !== null && existsSync(path),
    );
    if (listPath === undefined) return this.missingIgnored(version, tag);
    const text = readTextTolerant(listPath) ?? "";
    const left: string[] = [];
    let moved = 0;
    for (const line of text.split("\n")) {
      const [from = "", to = ""] = line.split("\t").map((part) => part.trim());
      if (from === "" || to === "") continue;
      const source = join(vaultPath, to);
      const target = join(vaultPath, from);
      try {
        if (!existsSync(source) || existsSync(target)) throw new Error("not movable");
        mkdirSync(dirname(target), { recursive: true });
        renameSync(source, target);
        moved += 1;
      } catch {
        left.push(`${to} (was ${from})`);
      }
    }
    for (const path of [ignoredMovesPath(vaultPath, version), kept]) if (path !== null) rmSync(path, { force: true });
    return [
      moved > 0 ? `${String(moved)} git-ignored ${moved === 1 ? "file is" : "files are"} back at the old place.` : "",
      left.length > 0 ? `Move these git-ignored files back by hand: ${left.join(", ")}.` : "",
    ]
      .filter((part) => part !== "")
      .join(" ");
  }

  /** With no list of the git-ignored moves: each ignored file of the inventory that is not at its place. */
  private missingIgnored(version: number, tag: string | null): string {
    const { vaultPath, stateFolder } = this.options;
    const name = `v${String(version)}-inventory.tsv`;
    const inventory = [join(upgradeFolder(vaultPath), name), tag === null ? null : join(stateFolder, tag, name)]
      .map((path) => (path === null ? null : readTextTolerant(path)))
      .find((text): text is string => text !== null);
    if (inventory === undefined)
      return "Some git-ignored files may need to move back: Eva has no list of the ones that the upgrade moved. Check the report of the upgrade.";
    const gone = inventory
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(([kind, , path = ""]) => kind === "ignored" && path !== "" && !existsSync(join(vaultPath, path)))
      .map(([, , path = ""]) => path);
    return gone.length === 0 ? "" : `These git-ignored files may need to move back: ${gone.join(", ")}.`;
  }

  private async head(): Promise<string> {
    return (await this.must(["rev-parse", "HEAD"], "read the commit")).stdout.trim();
  }

  private async currentBranch(): Promise<string> {
    return (await this.must(["rev-parse", "--abbrev-ref", "HEAD"], "read the branch")).stdout.trim();
  }

  /** The upgrade branches of the vault. */
  private async openBranches(): Promise<string[]> {
    const listed = await this.must(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], "list the branches");
    return listed.stdout.split("\n").filter((name) => upgradeBranchVersion(name.trim()) !== null);
  }

  /** The branch of the open upgrade: the current one, or the only one. */
  private async theOpenBranch(): Promise<string> {
    const current = await this.currentBranch();
    if (upgradeBranchVersion(current) !== null) return current;
    const open = await this.openBranches();
    if (open.length === 0) refuse("No vault upgrade is open on this computer.");
    if (open.length > 1) refuse(`More than one upgrade branch is open: ${open.join(", ")}. Switch the vault to one.`);
    return open[0] ?? "";
  }

  /** The commits of the notes written during an upgrade, oldest first. */
  private async notesCommits(range: string): Promise<string[]> {
    const listed = await this.must(
      ["log", "--reverse", "--format=%H", `--grep=^${notesMessage}$`, range],
      "find the notes written during the upgrade",
    );
    return listed.stdout.split("\n").filter((line) => line.trim() !== "");
  }

  /** The tag, or the same name with a number when an earlier upgrade took it. */
  private async freeTag(base: string): Promise<string> {
    for (let number = 1; ; number += 1) {
      const name = number === 1 ? base : `${base}-${String(number)}`;
      const local = await this.git(["rev-parse", "-q", "--verify", `refs/tags/${name}`]);
      if (local.exitCode === 0) continue;
      const remote = await this.git(["ls-remote", "--tags", "origin", `refs/tags/${name}`], networkTimeoutMs);
      if (remote.exitCode === 0 && remote.stdout.trim() !== "") continue;
      return name;
    }
  }

  /**
   * Clears what would stop a drop for nothing: a deleted file that only the upgrade made, and a new
   * file with the same text as on the default branch.
   */
  private async tidyForDrop(main: string): Promise<void> {
    const status = await this.must(["status", "--porcelain=v1", "-z"], "read the status");
    for (const entry of status.stdout.split("\0")) {
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      if (code !== " D" && code !== "??") continue;
      const onMain = await this.versionIn(main, path);
      if (code === " D" && onMain === null) await this.must(["checkout", "--", path], `put back ${path}`);
      if (code === "??" && onMain !== null && this.blobHash(path) === onMain.oid)
        rmSync(join(this.options.vaultPath, path), { force: true });
    }
  }

  /** The switch of a drop. A file that the sync kept out, such as a plain secret, can stand in its way. */
  private async switchForDrop(main: string): Promise<void> {
    const switched = await this.git(["switch", "-q", main]);
    if (switched.exitCode === 0) return;
    const withheld = this.options.sync.currentState.withheldFiles.map((file) => file.path);
    refuse(
      `Eva could not switch the vault to ${main}: ${gitReason(switched)}.${withheld.length === 0 ? "" : ` The sync kept these files out of its commit, as they look like secrets or are too big: ${withheld.join(", ")}. Move each one out of the vault folder, or into an encrypted file, then run eva vault-upgrade drop again.`}`,
    );
  }

  /** The version of a path in a commit, or null when the commit has no such file. */
  private async versionIn(commit: string, path: string): Promise<Stage | null> {
    const listed = await this.git(["ls-tree", "-z", commit, "--", path]);
    const match = /^(\d+) blob ([0-9a-f]+)\t/.exec(listed.stdout);
    return listed.exitCode === 0 && match !== null ? { mode: match[1] ?? "", oid: match[2] ?? "" } : null;
  }

  private async switchTo(branch: string): Promise<void> {
    await this.must(["switch", "-q", branch], `switch the vault to ${branch}`);
  }

  /**
   * Every file of the vault folder with its git blob hash: tracked, untracked, and ignored ones,
   * since a git-ignored file, such as a `.env`, does not follow a `git mv` of the other files. An
   * ignored folder counts as one entry, with no hash.
   */
  private async writeInventory(version: number): Promise<{ path: string; summary: string }> {
    const lines = ["kind\thash\tpath"];
    const tracked = await this.must(["ls-files", "-s", "-z"], "list the tracked files");
    let trackedCount = 0;
    for (const entry of tracked.stdout.split("\0")) {
      const [info = "", path = ""] = entry.split("\t");
      if (path === "" || outOfInventory.test(path)) continue;
      lines.push(`tracked\t${info.split(" ")[1] ?? ""}\t${path}`);
      trackedCount += 1;
    }
    const counts = { untracked: 0, ignored: 0 };
    for (const kind of ["untracked", "ignored"] as const) {
      const listed = await this.must(
        ["ls-files", "-o", "--exclude-standard", ...(kind === "ignored" ? ["-i", "--directory"] : []), "-z"],
        `list the ${kind} files`,
      );
      for (const path of listed.stdout.split("\0")) {
        if (path === "" || outOfInventory.test(path)) continue;
        lines.push(`${kind}\t${path.endsWith("/") ? "-" : this.blobHash(path)}\t${path}`);
        counts[kind] += 1;
      }
    }
    const folder = upgradeFolder(this.options.vaultPath);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, `v${String(version)}-inventory.tsv`);
    writeFileAtomic(path, `${lines.join("\n")}\n`);
    return {
      path,
      summary: `${String(trackedCount)} tracked, ${String(counts.untracked)} untracked and ${String(counts.ignored)} ignored`,
    };
  }

  /** The hash that git gives the file, so a tracked and an untracked copy compare. "-" when Eva cannot read it. */
  private blobHash(relativePath: string): string {
    try {
      const path = join(this.options.vaultPath, relativePath);
      if (!statSync(path).isFile()) return "-";
      const bytes = readFileSync(path);
      return createHash("sha1")
        .update(`blob ${String(bytes.length)}\0`)
        .update(bytes)
        .digest("hex");
    } catch {
      return "-";
    }
  }

  private git(arguments_: readonly string[], timeoutMs?: number): Promise<GitResult> {
    return this.options.sync.runGit(arguments_, timeoutMs);
  }

  private async must(arguments_: readonly string[], what: string): Promise<GitResult> {
    const result = await this.git(arguments_);
    if (result.exitCode !== 0) refuse(`Eva could not ${what}: ${gitReason(result)}`);
    return result;
  }
}

/** The list of the git-ignored files that the skill moved, one "<from>\t<to>" line each, so drop and undo move them back. */
export function ignoredMovesPath(vaultPath: string, version: number): string {
  return join(upgradeFolder(vaultPath), `v${String(version)}-ignored-moves.tsv`);
}

function refuse(reason: string): never {
  throw new EvaError("vault_upgrade_refused", reason);
}

/** The working files of an upgrade in the scratch folder, which Eva also keeps on this computer. */
function workingFiles(vaultPath: string, version: number): string[] {
  const folder = upgradeFolder(vaultPath);
  return ["inventory.tsv", "report.md", "ignored-moves.tsv"].map((name) => join(folder, `v${String(version)}-${name}`));
}

/** About me with no `lastLocation` and its comment: the phone writes them, so they make no conflict copy. */
function withoutLocation(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("lastLocation:") && !line.startsWith("# Eva's code fills lastLocation"))
    .join("\n");
}

/** git's first line, and each file that it lists on the lines after, such as the files that block a merge. */
function gitReason(result: GitResult): string {
  const lines = `${result.stderr}\n${result.stdout}`.split("\n");
  const files = lines.filter((line) => line.startsWith("\t")).map((line) => line.trim());
  return files.length === 0 ? firstLine(result) : `${firstLine(result)} ${files.join(", ")}`;
}

function firstLine(result: GitResult): string {
  return (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
}

function notesWords(files: readonly string[]): string {
  return files.length === 0
    ? ""
    : `Notes that other chats wrote meanwhile, committed apart: ${files.join(", ")}. If one of them is the skill's own unfinished work, fix it now.`;
}

function copiesWords(copies: readonly string[]): string {
  return copies.length === 0
    ? ""
    : `Two versions of some files met. Each path keeps one, and the other one is in a copy beside it: ${copies.join(", ")}. Merge each copy with the person, then delete it.`;
}

function syncWords(status: string, lastError: string | null): string {
  return status === "ok"
    ? "The sync runs again, and the remote has the change."
    : `The sync runs again, but its last step says: ${lastError ?? status}.`;
}
