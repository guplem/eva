/**
 * The safe steps of a vault upgrade (#773), for the `vault-upgrade` skill: `eva vault-upgrade
 * start|finish|drop|undo`. The skill does the work itself, on a branch in the vault folder. These
 * steps make the backup tag, pause the sync, merge, record the version and go back. Notes that other
 * chats write meanwhile land on the branch, and each step keeps them.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import {
  newestStructureVersion,
  pendingChanges,
  readVaultStructure,
  upgradeBranch,
  upgradeBranchVersion,
  writeVaultStructure,
} from "./vault-structure.ts";
import type { GitResult, VaultSync } from "./vault-sync.ts";

export type UpgradeAction = "start" | "finish" | "drop" | "undo";

/** The message of each commit of the notes that other chats wrote during the upgrade. */
const notesMessage = "Notes written during the upgrade";
const upgradeMessage = (version: number): string => `Upgrade the vault structure to v${String(version)}`;
const undoMessage = (version: number): string => `Undo the vault structure upgrade to v${String(version)}`;
const networkTimeoutMs = 60_000;
/** Folders that the inventory leaves out: temporary files, and the clones with their own git. */
const outOfInventory = /^(\.git\/|\.eva\/scratch\/|Scratch\/|Projects\/[^/]+\/repos\/)/;

export interface VaultUpgradeOptions {
  readonly vaultPath: string;
  readonly sync: VaultSync;
  readonly isHub: () => boolean;
  /** `<state>/vault-upgrade/`: the inventory and the report live here, outside the vault. */
  readonly folder: string;
  /** The folder of the `vault-upgrade` skill, with its template texts. */
  readonly skillFolder: () => string;
  /** Runs what the open branch held back: the vault migrations and the template alignment. */
  readonly afterBranch: () => void;
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
    });
    // The sync marks itself paused at once, so the status says so before its next step.
    await sync.pull();
    const inventory = await this.writeInventory(target);
    const skill = this.options.skillFolder();
    return [
      `The upgrade to vault structure version ${String(target)} started.`,
      `- Backup tag: ${tag}, on the remote too.`,
      `- Branch: ${branch}, in the vault folder. The sync is paused until finish or drop.`,
      `- Inventory: ${inventory.path} (${inventory.summary}).`,
      `- Write the report to ${join(this.options.folder, `v${String(target)}-report.md`)}.`,
      `- Newest template texts: ${join(skill, "template")}. Every version that Eva shipped: ${join(skill, "shipped")}.`,
    ].join("\n");
  }

  private async finish(): Promise<string> {
    this.requireHub();
    const { vaultPath, sync } = this.options;
    const branch = await this.theOpenBranch();
    const version = upgradeBranchVersion(branch) ?? 0;
    assertVaultWritable(vaultPath);
    if ((await this.currentBranch()) === branch) await this.commitNotes();
    const main = await sync.mainBranch();
    await sync.exclusive(() => this.switchTo(main));
    const pulled = await sync.pull();
    if (pulled.status === "conflict" || pulled.status === "error")
      refuse(
        `The pull of ${main} stopped: ${pulled.lastError ?? pulled.status}. Resolve it, then run eva vault-upgrade finish again.`,
      );
    await sync.exclusive(async () => {
      const merged = await this.git(["merge", "--no-ff", "--no-commit", "-q", branch]);
      if (merged.exitCode !== 0) {
        const files = await this.conflictedFiles();
        await this.git(["merge", "--abort"]);
        await this.switchTo(branch);
        refuse(
          files.length === 0
            ? `The merge failed: ${firstLine(merged)}. Nothing changed.`
            : `The merge stopped on a conflict in ${files.join(", ")}. Nothing changed. Merge ${main} into ${branch}, resolve each file, commit, and run eva vault-upgrade finish again.`,
        );
      }
      // The record goes into the merge commit, so undo takes back both at once.
      writeVaultStructure(vaultPath, version);
      await this.must(["add", "--", ".eva/vault-structure.json"], "stage the version record");
      await this.must(["commit", "-q", "--no-verify", "-m", upgradeMessage(version)], "commit the merge");
      await this.must(["branch", "-q", "-D", branch], `delete the branch ${branch}`);
    });
    const saved = await sync.save();
    this.options.afterBranch();
    return [
      `The vault follows structure version ${String(version)} now. ${branch} is merged into ${main}, with the version record.`,
      syncWords(saved.status, saved.lastError),
      "The backup tag stays. To go back, run eva vault-upgrade undo.",
    ].join(" ");
  }

  private async drop(): Promise<string> {
    const { sync } = this.options;
    const branch = await this.theOpenBranch();
    const onBranch = (await this.currentBranch()) === branch;
    if (onBranch) await this.commitNotes();
    const main = await sync.mainBranch();
    await sync.exclusive(async () => {
      const notes = await this.notesCommits(`${main}..${branch}`);
      if (onBranch) await this.switchTo(main);
      // A pick finds a moved note again by git's rename detection, so an edit goes back to the old path.
      for (const commit of notes) {
        const picked = await this.git(["cherry-pick", commit]);
        if (picked.exitCode === 0) continue;
        const files = await this.conflictedFiles();
        await this.git(["cherry-pick", "--abort"]);
        if (onBranch) await this.switchTo(branch);
        refuse(
          `The notes written during the upgrade conflict with ${main} in ${files.join(", ") || firstLine(picked)}. Nothing changed. Resolve them on ${branch}, then run eva vault-upgrade drop again.`,
        );
      }
      await this.must(["branch", "-q", "-D", branch], `delete the branch ${branch}`);
    });
    const saved = await sync.save();
    this.options.afterBranch();
    return [
      `The upgrade is dropped. The vault is on ${main} as before, with the notes written meanwhile.`,
      syncWords(saved.status, saved.lastError),
      "The backup tag stays.",
    ].join(" ");
  }

  private async undo(): Promise<string> {
    this.requireHub();
    const { vaultPath, sync } = this.options;
    const open = await this.openBranches();
    if (open.length > 0)
      refuse(`An upgrade is open on ${open.join(", ")}. Run eva vault-upgrade finish or eva vault-upgrade drop first.`);
    assertVaultWritable(vaultPath);
    const version = readVaultStructure(vaultPath);
    const found = await this.git([
      "log",
      "--first-parent",
      "-1",
      "--format=%H %P",
      `--grep=^${upgradeMessage(version)}$`,
      "HEAD",
    ]);
    const [commit, ...parents] = found.stdout.trim().split(" ");
    if (found.exitCode !== 0 || commit === undefined || commit === "")
      refuse(`The vault has no upgrade to version ${String(version)} to undo.`);
    await sync.save();
    const changed = (await this.must(["status", "--porcelain", "--untracked-files=no"], "read the status")).stdout;
    if (changed.trim() !== "")
      refuse(`These files have changes that are not committed: ${changed.trim()}. Sync the vault, then try again.`);
    await sync.exclusive(async () => {
      const isMerge = parents.length > 1;
      const steps: string[][] = [["revert", "--no-commit", ...(isMerge ? ["-m", "1"] : []), commit]];
      // The notes that other chats wrote during the upgrade stay: they come back after the revert.
      if (isMerge)
        for (const notes of await this.notesCommits(`${commit}^1..${commit}^2`))
          steps.push(["cherry-pick", "--no-commit", notes]);
      for (const step of steps) {
        const result = await this.git(step);
        if (result.exitCode === 0) continue;
        const files = await this.conflictedFiles();
        await this.git(["reset", "-q", "--merge"]);
        refuse(
          `The undo stopped on a conflict in ${files.join(", ") || firstLine(result)}. Nothing changed. Notes written since the upgrade change the same files.`,
        );
      }
      // A removed secret pattern needs the person's yes, and a pattern for both paths does no harm.
      if ((await this.git(["cat-file", "-e", "HEAD:.eva/secret-files"])).exitCode === 0)
        await this.must(["checkout", "HEAD", "--", ".eva/secret-files"], "keep the secret patterns");
      await this.must(["commit", "-q", "--no-verify", "-m", undoMessage(version)], "commit the undo");
    });
    const saved = await sync.save();
    return [
      `The upgrade to version ${String(version)} is undone. The vault is as before it, plus the notes written since. The vault structure card offers the upgrade again.`,
      syncWords(saved.status, saved.lastError),
    ].join(" ");
  }

  private requireHub(): void {
    if (!this.options.isHub())
      refuse("Only the hub computer upgrades the vault structure. Run this on the hub, or ask in a chat there.");
  }

  private async commitNotes(): Promise<void> {
    const { sync } = this.options;
    if (!(await sync.commitAll(notesMessage)))
      refuse(
        `Eva could not commit the notes written during the upgrade: ${sync.currentState.lastError ?? "unknown reason"}.`,
      );
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

  private async switchTo(branch: string): Promise<void> {
    await this.must(["switch", "-q", branch], `switch the vault to ${branch}`);
  }

  private async conflictedFiles(): Promise<string[]> {
    const listed = await this.git(["diff", "--name-only", "--diff-filter=U", "-z"]);
    return listed.stdout.split("\0").filter((path) => path !== "");
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
    mkdirSync(this.options.folder, { recursive: true });
    const path = join(this.options.folder, `v${String(version)}-inventory.tsv`);
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
    if (result.exitCode !== 0) refuse(`Eva could not ${what}: ${firstLine(result)}`);
    return result;
  }
}

function refuse(reason: string): never {
  throw new EvaError("vault_upgrade_refused", reason);
}

function firstLine(result: GitResult): string {
  return (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
}

function syncWords(status: string, lastError: string | null): string {
  return status === "ok"
    ? "The sync runs again, and the remote has the change."
    : `The sync runs again, but its last step says: ${lastError ?? status}.`;
}
