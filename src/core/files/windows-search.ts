/**
 * The vault in the Windows Search index, so the Start menu finds its files (#942). Windows reads no
 * `.gitignore`, so Eva gives it one exclude rule for each entry that git ignores, each `.git` folder
 * and each secret file. A PowerShell script changes the rules, with no administrator rights.
 *
 * The save of the rules can hang for hours, and the Windows Search service with it. So the script runs
 * in a child process with a timeout, and saves only after a change.
 */
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../shared/files.ts";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import type { AlertProblem } from "../alerts/alert-center.ts";
import { listClones } from "../projects/clones.ts";
import { secretMatcherOf } from "./secret-paths.ts";
import syncScript from "./windows-search.ps1" with { type: "text" };

/** A few hundred rules save in about a second. A list much longer would only slow the indexer. */
export const maxSearchRules = 1000;
/** A save that works takes under a second. One that hangs never ends. */
const syncTimeoutMs = 60_000;
const gitTimeoutMs = 30_000;

export interface SearchIndexGit {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
}

/** The rules that one sync asks for. */
export interface SearchScopeRequest {
  readonly vaultPath: string;
  /** Paths from the vault root, with `/`. A folder ends with `/`. */
  readonly excludes: readonly string[];
  /** Folders from the vault root, ending with `/`, whose old rules stay as they are. */
  readonly keep?: readonly string[];
  /** True to remove every rule of the vault, as the uninstall does. */
  readonly remove: boolean;
}

export type SearchIndexResult =
  | {
      readonly kind: "synced";
      readonly added: number;
      readonly removed: number;
      /** True when the list passed the limit, so some ignored entries stay in the index. */
      readonly cut?: boolean;
      /** The patterns that Windows refused. Their folders still get their own rules. */
      readonly skipped?: number;
    }
  /** The Windows Search service is off or missing: nothing to do. */
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "timeout" };

/** The output of one git command, or null when git fails or does not end. */
async function gitOutput(folder: string, git: SearchIndexGit, args: readonly string[]): Promise<string | null> {
  try {
    // Without --no-optional-locks, a status takes index.lock, and a commit of a turn at the same time fails.
    const result = await git.runner.run(["git", "--no-optional-locks", ...args], {
      cwd: folder,
      environment: git.environment,
      timeoutMs: gitTimeoutMs,
    });
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

/**
 * Each entry that matches an ignore rule in `folder`: a folder as one entry that ends with `/`. Null when
 * git fails. Plain `--ignored` would name a parent folder that holds only ignored files, such as `.eva/`.
 */
async function ignoredEntries(folder: string, git: SearchIndexGit): Promise<string[] | null> {
  const output = await gitOutput(folder, git, [
    "status",
    "--porcelain",
    "-z",
    "--ignored=matching",
    "--untracked-files=normal",
  ]);
  if (output === null) return null;
  return output
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3));
}

/** Each secret file of the vault that git does not ignore. Its name alone could tell too much. Null when git fails. */
async function secretFiles(vaultPath: string, git: SearchIndexGit): Promise<string[] | null> {
  const output = await gitOutput(vaultPath, git, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (output === null) return null;
  const secrets = secretMatcherOf(vaultPath);
  return output.split("\0").filter((path) => path !== "" && secrets.matches(path));
}

function projectFolders(vaultPath: string): string[] {
  try {
    return readdirSync(join(vaultPath, "Projects"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** A `*` matches one folder level: `Projects/<project>/repos/clone-<n>/<repository>/`. */
const clonePatterns = ["Projects/*/repos/*/*/.git/", "Projects/*/repos/*/*/node_modules/"];

/** The vault's `.gitignore` lists the clones, but their tracked files belong in the search. */
const clonesFolder = /^Projects\/[^/]+\/repos(\/|$)/;

/** The exclude rules of a vault, and whether the limit cut some. */
export interface SearchExclusions {
  readonly excludes: readonly string[];
  /** The repositories where git failed: the sync keeps their old rules. Paths end with `/`. */
  readonly keep: readonly string[];
  readonly cut: boolean;
}

/**
 * The exclude rules of the vault, or null when git cannot list the vault's own: the sync then keeps
 * the old rules, so a secret file never enters the index. A clone repository where git fails keeps
 * its old rules, and the rest of the vault still syncs. A `*` rule of Windows matches one folder
 * level only, so each ignored folder gets its own rule. The `.git` folders and the secret files
 * come first, so a cut list keeps them.
 */
export async function searchExclusions(vaultPath: string, git: SearchIndexGit): Promise<SearchExclusions | null> {
  const vaultIgnored = await ignoredEntries(vaultPath, git);
  const secrets = await secretFiles(vaultPath, git);
  if (vaultIgnored === null || secrets === null) return null;
  // Each pattern already covers these folders. The folder rules stay for a Windows that refuses a pattern.
  const repositoryGitFolders: string[] = [];
  const ignored = vaultIgnored.filter((entry) => !clonesFolder.test(entry));
  const keep: string[] = [];
  for (const project of projectFolders(vaultPath)) {
    for (const clone of listClones(join(vaultPath, "Projects", project))) {
      for (const repository of clone.repositories) {
        const prefix = `Projects/${project}/repos/${clone.name}/${repository.name}/`;
        repositoryGitFolders.push(`${prefix}.git/`);
        const entries = await ignoredEntries(repository.path, git);
        if (entries === null) keep.push(prefix);
        else for (const entry of entries) ignored.push(prefix + entry);
      }
    }
  }
  // The clone layout has a fixed depth, so the patterns cover a new clone before its first sync,
  // and a `node_modules` that a turn makes before the turn ends.
  const all = [...new Set([".git/", ...clonePatterns, ...secrets, ...repositoryGitFolders, ...ignored])];
  return { excludes: all.slice(0, maxSearchRules), keep, cut: all.length > maxSearchRules };
}

export interface SearchScopeRun {
  readonly runner: ProcessRunner;
  /** The environment of PowerShell. It names `SystemRoot`. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where the script and its input go. The uninstall runs the same script from there. */
  readonly folder: string;
}

/** The file names that `install/uninstall.ps1` reads too. */
export const syncScriptName = "sync-search-scope.ps1";
export const syncInputName = "sync-search-scope.json";

function reasonIn(stdout: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string")
      return parsed.error;
  } catch {
    // An output that is no JSON line gives no reason.
  }
  return null;
}

function countIn(stdout: string, field: "added" | "removed" | "skipped"): number {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (typeof parsed !== "object" || parsed === null || !(field in parsed)) return 0;
    const value: unknown = (parsed as Record<string, unknown>)[field];
    // PowerShell writes a list of one item as the item alone.
    return Array.isArray(value) ? value.length : value === null || value === undefined ? 0 : 1;
  } catch {
    return 0;
  }
}

/** Writes the script and the request to `run.folder`, and runs the script with a timeout. */
export async function runSearchScopeSync(run: SearchScopeRun, request: SearchScopeRequest): Promise<SearchIndexResult> {
  const script = join(run.folder, syncScriptName);
  const input = join(run.folder, syncInputName);
  const systemRoot = run.environment["SystemRoot"] ?? run.environment["SYSTEMROOT"] ?? "C:\\Windows";
  const command = [
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-InputFile",
    input,
  ];
  try {
    mkdirSync(run.folder, { recursive: true });
    writeFileAtomic(script, syncScript);
    // A file, not the input pipe: Windows PowerShell never reads a line from the pipe that Bun gives it (#457).
    writeFileAtomic(input, JSON.stringify(request));
    const result = await run.runner.run(command, {
      cwd: run.folder,
      environment: run.environment,
      timeoutMs: syncTimeoutMs,
    });
    if (result.exitCode === 0) {
      const skipped = countIn(result.stdout, "skipped");
      const counts = { added: countIn(result.stdout, "added"), removed: countIn(result.stdout, "removed") };
      return skipped === 0 ? { kind: "synced", ...counts } : { kind: "synced", ...counts, skipped };
    }
    const reason = reasonIn(result.stdout) ?? failureReason(result, "PowerShell");
    return result.exitCode === 2 ? { kind: "unavailable", reason } : { kind: "failed", reason };
  } catch (error) {
    if (error instanceof EvaError && error.code === "process_timeout") return { kind: "timeout" };
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The problem of a sync. Windows Search that is off is the person's choice, so it is no problem. */
export function searchIndexProblem(result: SearchIndexResult): AlertProblem | null {
  const resolvedMessage = "The Start menu of Windows finds the files of your vault again.";
  if (result.kind === "timeout")
    return {
      level: "warn",
      message:
        "Windows Search did not answer when Eva added your vault to the Start menu search. The search service of Windows can hang: restart this computer. Eva tries again at her next start.",
      resolvedMessage,
    };
  if (result.kind === "failed")
    return {
      level: "warn",
      message: `Eva could not add your vault to the Start menu search of Windows: ${result.reason.replace(/\.$/, "")}. She tries again later.`,
      resolvedMessage,
    };
  return null;
}

/**
 * Runs one sync at a time. A request during a sync runs one more sync after it, so the last
 * change always counts. After a sync that returns "stop", every request does nothing.
 */
export class SearchIndexSync {
  private running: Promise<void> | null;
  private again: boolean;
  private stopped: boolean;
  private readonly sync: () => Promise<"stop" | undefined>;

  constructor(sync: () => Promise<"stop" | undefined>) {
    this.sync = sync;
    this.running = null;
    this.again = false;
    this.stopped = false;
  }

  request(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop();
    return this.running;
  }

  // A method, so the linter does not read the field as the value that the loop set before the await.
  private wantsAgain(): boolean {
    return this.again && !this.stopped;
  }

  private async loop(): Promise<void> {
    try {
      do {
        this.again = false;
        if ((await this.sync()) === "stop") this.stopped = true;
      } while (this.wantsAgain());
    } finally {
      this.running = null;
    }
  }
}

/** A sync of the vault's rules: Eva gives the vault path and her git, and gets the result. */
export type VaultSearchIndex = (vaultPath: string, git: SearchIndexGit) => Promise<SearchIndexResult>;

/**
 * The sync that a Windows computer runs: the exclude list, then the script. A list that is the same
 * as the last one that synced starts no PowerShell: each start of it compiles the C# code again.
 * The first sync of a run always checks, because Windows can lose rules whose save did not end.
 */
export function vaultSearchIndex(run: SearchScopeRun): VaultSearchIndex {
  let last: { readonly key: string; readonly result: SearchIndexResult } | null = null;
  return async (vaultPath, git) => {
    const exclusions = await searchExclusions(vaultPath, git);
    if (exclusions === null)
      return { kind: "failed", reason: "Git could not list the ignored files, so Eva keeps the old rules." };
    const request = { vaultPath, excludes: exclusions.excludes, keep: exclusions.keep, remove: false };
    const key = JSON.stringify(request);
    // The same list gives the same answer: a refusal by Windows would only come again.
    if (key === last?.key)
      return last.result.kind === "synced" ? { kind: "synced", added: 0, removed: 0 } : last.result;
    const synced = await runSearchScopeSync(run, request);
    const result: SearchIndexResult =
      synced.kind !== "synced"
        ? synced
        : exclusions.keep.length > 0
          ? {
              kind: "failed",
              reason: `Git could not read ${exclusions.keep.join(", ")}, so Eva keeps the old rules there.`,
            }
          : exclusions.cut
            ? { ...synced, cut: true }
            : synced;
    // A timeout leaves the rules unknown, so it remembers nothing.
    last = synced.kind === "timeout" ? null : { key, result };
    return result;
  };
}
