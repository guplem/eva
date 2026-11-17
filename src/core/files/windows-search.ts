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
  /** True to remove every rule of the vault, as the uninstall does. */
  readonly remove: boolean;
}

export type SearchIndexResult =
  | { readonly kind: "synced"; readonly added: number; readonly removed: number }
  /** The Windows Search service is off or missing: nothing to do. */
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "timeout" };

/**
 * Each entry that matches an ignore rule in `folder`: a folder as one entry that ends with `/`. Empty when
 * git fails. Plain `--ignored` would name a parent folder that holds only ignored files, such as `.eva/`.
 */
async function ignoredEntries(folder: string, git: SearchIndexGit): Promise<string[]> {
  try {
    const result = await git.runner.run(
      ["git", "status", "--porcelain", "-z", "--ignored=matching", "--untracked-files=normal"],
      {
        cwd: folder,
        environment: git.environment,
        timeoutMs: gitTimeoutMs,
      },
    );
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\0")
      .filter((entry) => entry.startsWith("!! "))
      .map((entry) => entry.slice(3));
  } catch {
    return [];
  }
}

/** Each secret file of the vault that git does not ignore. Its name alone could tell too much. */
async function secretFiles(vaultPath: string, git: SearchIndexGit): Promise<string[]> {
  try {
    const result = await git.runner.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: vaultPath,
      environment: git.environment,
      timeoutMs: gitTimeoutMs,
    });
    if (result.exitCode !== 0) return [];
    const secrets = secretMatcherOf(vaultPath);
    return result.stdout.split("\0").filter((path) => path !== "" && secrets.matches(path));
  } catch {
    return [];
  }
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

/** The vault's `.gitignore` lists the clones, but their tracked files belong in the search. */
const clonesFolder = /^Projects\/[^/]+\/repos(\/|$)/;

/**
 * The exclude rules of the vault. A `*` rule of Windows matches one folder level only, so each
 * ignored folder gets its own rule. The `.git` folders come first, so a cut list keeps them.
 */
export async function searchExclusions(vaultPath: string, git: SearchIndexGit): Promise<string[]> {
  const gitFolders = [".git/"];
  const ignored = (await ignoredEntries(vaultPath, git)).filter((entry) => !clonesFolder.test(entry));
  const secrets = await secretFiles(vaultPath, git);
  for (const project of projectFolders(vaultPath)) {
    for (const clone of listClones(join(vaultPath, "Projects", project))) {
      for (const repository of clone.repositories) {
        const prefix = `Projects/${project}/repos/${clone.name}/${repository.name}/`;
        gitFolders.push(`${prefix}.git/`);
        for (const entry of await ignoredEntries(repository.path, git)) ignored.push(prefix + entry);
      }
    }
  }
  return [...new Set([...gitFolders, ...ignored, ...secrets])].slice(0, maxSearchRules);
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

function countIn(stdout: string, field: "added" | "removed"): number {
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
  mkdirSync(run.folder, { recursive: true });
  const script = join(run.folder, syncScriptName);
  const input = join(run.folder, syncInputName);
  writeFileAtomic(script, syncScript);
  // A file, not the input pipe: Windows PowerShell never reads a line from the pipe that Bun gives it (#457).
  writeFileAtomic(input, JSON.stringify(request));
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
    const result = await run.runner.run(command, {
      cwd: run.folder,
      environment: run.environment,
      timeoutMs: syncTimeoutMs,
    });
    if (result.exitCode === 0)
      return { kind: "synced", added: countIn(result.stdout, "added"), removed: countIn(result.stdout, "removed") };
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

/** The sync that a Windows computer runs: the exclude list, then the script. */
export function vaultSearchIndex(run: SearchScopeRun): VaultSearchIndex {
  return async (vaultPath, git) =>
    runSearchScopeSync(run, { vaultPath, excludes: await searchExclusions(vaultPath, git), remove: false });
}
