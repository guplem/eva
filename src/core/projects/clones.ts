/**
 * Clones live in `Projects/<project>/repos/<repo>-<n>/`. Each one is
 * a parallel workspace. Trust decides whether a clone's own hooks and MCP servers may
 * run.
 */
import { githubCredentialArguments } from "../vault/vault-clone.ts";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";

const gitTimeoutMs = 20_000;

export interface Clone {
  readonly name: string;
  readonly path: string;
  readonly repository: string;
  readonly index: number;
}

const cloneTimeoutMs = 10 * 60_000;
const cloneNamePattern = /^(.+)-(\d+)$/;

/** The repository part of a git URL or path: `https://github.com/o/app.git` → `app`. */
export function repositoryName(url: string): string {
  const trimmed = url.replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const parts = trimmed.split(/[\\/:]/);
  return parts[parts.length - 1] ?? trimmed;
}

/** The first free `<repo>-<n>` folder name in the project's `repos/` folder. */
export function cloneFolderName(projectPath: string, repository: string): string {
  const reposFolder = join(projectPath, "repos");
  for (let index = 0; ; index += 1) {
    const name = `${repository}-${String(index)}`;
    if (!existsSync(join(reposFolder, name))) return name;
  }
}

/** A broken link or a folder without rights is not a clone. It must not break the project list (lesson 54). */
function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The clones of a project, sorted by repository and number. */
export function listClones(projectPath: string): Clone[] {
  const reposFolder = join(projectPath, "repos");
  if (!isFolder(reposFolder)) return [];
  let names: string[];
  try {
    names = readdirSync(reposFolder);
  } catch {
    return [];
  }
  const clones: Clone[] = [];
  for (const name of names) {
    const match = cloneNamePattern.exec(name);
    const path = join(reposFolder, name);
    if (!match || !isFolder(path)) continue;
    clones.push({ name, path, repository: match[1] ?? name, index: Number(match[2]) });
  }
  return clones.sort(
    (first, second) => first.repository.localeCompare(second.repository) || first.index - second.index,
  );
}

export interface CreateCloneOptions {
  readonly projectPath: string;
  readonly repositoryUrl: string;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly origins: CloneOriginStore;
}

/** Clones the repository into the next free folder, and records the URL it came from. */
export async function createClone(options: CreateCloneOptions): Promise<Clone> {
  // The URL comes from front matter or the API. Git reads `--upload-pack=<command>` as an option
  // and runs the command, so refuse it here too, and not only with the `--` below.
  if (options.repositoryUrl.startsWith("-")) {
    throw new EvaError("project_invalid", `A repository URL cannot start with "-": ${options.repositoryUrl}`);
  }
  const repository = repositoryName(options.repositoryUrl);
  const name = cloneFolderName(options.projectPath, repository);
  const reposFolder = join(options.projectPath, "repos");
  const path = join(reposFolder, name);
  const existed = existsSync(path);
  let result: Awaited<ReturnType<ProcessRunner["run"]>>;
  try {
    // Eva's credential helper, so a private project repository clones with the GitHub token too.
    result = await options.runner.run(
      ["git", ...githubCredentialArguments, "clone", "-q", "--", options.repositoryUrl, path],
      {
        cwd: options.projectPath,
        environment: { ...options.environment, GIT_TERMINAL_PROMPT: "0" },
        timeoutMs: cloneTimeoutMs,
      },
    );
  } catch (error) {
    if (!existed) removeFailedClone(path);
    throw error;
  }
  if (result.exitCode !== 0) {
    if (!existed) removeFailedClone(path);
    throw new EvaError("git_failed", `Could not clone ${options.repositoryUrl}: ${failureReason(result, "git")}`);
  }
  options.origins.recordClone(path, options.repositoryUrl);
  return { name, path, repository, index: Number(name.slice(repository.length + 1)) };
}

/**
 * A clone that a timeout or a kill stopped leaves a half-filled folder, and the next clone choice
 * could reuse it. The folder is new, so it holds none of the person's files.
 */
function removeFailedClone(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A file that Windows still holds stays. The clone error matters more than this one.
  }
}

export interface CloneBranch extends Clone {
  readonly branch: string | null;
  /** The number of the open pull request of the branch, when `gh` finds one. */
  readonly pullRequest: number | null;
}

/** Null counts when the branch has no upstream or git fails. */
export interface SyncState {
  /** Local commits that the upstream lacks. */
  readonly ahead: number | null;
  /** Upstream commits that the clone lacks, as of the last fetch. */
  readonly behind: number | null;
}

export interface CloneDetails extends CloneBranch, SyncState {
  /** The files that `git status` lists: changed, staged or new. Null when git fails. */
  readonly changes: number | null;
}

/** A clone with its current branch and pull request, for a project work report and the project view. */
export async function describeClone(
  clone: Clone,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<CloneBranch> {
  const options = gitOptions(clone, environment);
  let branch: string | null = null;
  let pullRequest: number | null = null;
  try {
    const head = await runner.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], options);
    if (head.exitCode === 0) branch = head.stdout.trim();
    const view = await runner.run(["gh", "pr", "view", "--json", "number", "--jq", ".number"], options);
    const number = Number.parseInt(view.stdout.trim(), 10);
    if (view.exitCode === 0 && Number.isSafeInteger(number)) pullRequest = number;
  } catch {
    // No git or no gh: the clone still shows, without the missing detail.
  }
  return { ...clone, branch, pullRequest };
}

/**
 * The number of changed files of a clone, for its card in the project view, or null when git fails.
 * Apart from describeClone, so a project work report does not wait for it: git is slow on Windows.
 */
export async function countChanges(
  clone: Clone,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<number | null> {
  try {
    // No index refresh, so no index.lock: a timeout kill would leave the lock and block the agent's git (lesson 81).
    // A new folder counts once, so a big folder that is not ignored stays fast.
    const status = await runner.run(
      ["git", "--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"],
      gitOptions(clone, environment),
    );
    if (status.exitCode !== 0) return null;
    return status.stdout.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return null;
  }
}

function gitOptions(
  clone: Clone,
  environment: Readonly<Record<string, string>>,
): { cwd: string; environment: Record<string, string>; timeoutMs: number } {
  return { cwd: clone.path, environment: { ...environment, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 20_000 };
}

/** The `origin` URL of a git folder, or null. Through the process seam, so it has a timeout (lessons 81, 102). */
export async function readOriginUrl(
  folder: string,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<string | null> {
  const result = await runner.run(["git", "remote", "get-url", "origin"], {
    cwd: folder,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: gitTimeoutMs,
  });
  const url = result.stdout.trim();
  return result.exitCode === 0 && url.length > 0 ? url : null;
}

/** Whether a git folder has no change, staged or not, and no untracked file. */
export async function isCleanFolder(
  folder: string,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<boolean> {
  const result = await runner.run(["git", "status", "--porcelain"], {
    cwd: folder,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: gitTimeoutMs,
  });
  return result.exitCode === 0 && result.stdout.trim().length === 0;
}

/** `owner/name` of a GitHub repository URL, or null for any other URL. */
export function githubSlug(repositoryUrl: string): string | null {
  // Anchored at the start: `https://evil.example/github.com/<owner>/` must not count as GitHub.
  // Only the characters of a real GitHub name: the slug goes into API paths and into commands
  // that the person copies, so `..`, `?`, `:owner` or `$(...)` must never pass.
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      repositoryUrl,
    );
  const owner = match?.[1];
  const name = match?.[2];
  if (owner === undefined || name === undefined || [owner, name].some((part) => /^\.+$/.test(part))) return null;
  return `${owner}/${name}`;
}

/** True when the repository's owner is on the allowlist (default trust). GitHub only. */
export function isTrustedByDefault(repositoryUrl: string, trustedOwners: readonly string[]): boolean {
  const owner = githubSlug(repositoryUrl)?.split("/")[0]?.toLowerCase();
  return owner !== undefined && trustedOwners.some((trusted) => trusted.toLowerCase() === owner);
}

export type TrustDecision = "trusted" | "untrusted" | "unknown";

/** The person's trust answers, by repository URL, in `state/trust.json`. */
export class TrustStore {
  private readonly path: string;
  private readonly decisions: Record<string, "trusted" | "untrusted">;

  constructor(path: string) {
    this.path = path;
    const read = readJsonTolerant(path);
    this.decisions = read.ok && isDecisionMap(read.value) ? read.value : {};
  }

  decision(repositoryUrl: string): TrustDecision {
    return this.decisions[repositoryUrl] ?? "unknown";
  }

  remember(repositoryUrl: string, decision: "trusted" | "untrusted"): void {
    this.decisions[repositoryUrl] = decision;
    this.save();
  }

  /** Each answer by its shown URL, so a token in a saved URL never leaves the core. */
  answers(): TrustAnswer[] {
    // Two URLs that differ only in their user part show as one row: one Remove forgets both.
    const byUrl = new Map<string, TrustAnswer>();
    for (const [url, decision] of Object.entries(this.decisions)) {
      const shown = shownUrl(url);
      // A denial wins, so the row never shows trust that one of the URLs lacks.
      if (byUrl.get(shown)?.decision !== "untrusted") byUrl.set(shown, { url: shown, decision });
    }
    return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
  }

  /** Removes every answer shown as this URL, so Eva asks again. */
  forget(shown: string): void {
    const urls = Object.keys(this.decisions).filter((url) => shownUrl(url) === shown);
    if (urls.length === 0) return;
    for (const url of urls) Reflect.deleteProperty(this.decisions, url);
    this.save();
  }

  private save(): void {
    writeFileAtomic(this.path, JSON.stringify(this.decisions, null, 2) + "\n");
  }
}

export interface TrustAnswer {
  readonly url: string;
  readonly decision: "trusted" | "untrusted";
}

const shownUrlLimit = 200;

/**
 * A URL as the phone shows it. The clone writes its own `origin`, so the text can hold a token in
 * its user part, line breaks that fake a second line, or a tail long enough to hide the question.
 */
export function shownUrl(url: string): string {
  const clean = url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1")
    // A short git address (`user:token@host:path`) has no scheme. A plain `git@` user carries no secret, so it stays.
    .replace(/^[^@/:\s]+:[^@/\s]*@/, "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim();
  return clean.length <= shownUrlLimit ? clean : `${clean.slice(0, shownUrlLimit)}…`;
}

function isDecisionMap(value: unknown): value is Record<string, "trusted" | "untrusted"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry === "trusted" || entry === "untrusted");
}

/**
 * What Eva knows about where a clone came from.
 * - `cloned`: Eva cloned the URL, and the answers by URL apply.
 * - `answered`: the person judged this folder, and the answer holds for it only. The URL is what
 *   the question showed.
 * - `replaced`: Eva cloned the URL, but the folder is not the one she cloned, so it can hold anything.
 */
export type CloneOrigin =
  | { readonly kind: "cloned"; readonly url: string }
  | { readonly kind: "answered"; readonly url: string; readonly decision: "trusted" | "untrusted" }
  | { readonly kind: "replaced"; readonly url: string };

interface StoredOrigin {
  readonly url: string;
  /** The random text in the clone's marker file. A folder made again at the same path lacks it. */
  readonly marker: string;
  readonly decision?: "trusted" | "untrusted";
}

/** The marker file in the clone's git folder. Git ignores it, and the harness never reads it. */
const markerFileName = "eva-clone-id";

/**
 * The origin of each clone, by folder, in `state/clone-origins.json`. Trust reads it, not the live
 * `origin` remote, which any edit of the clone's `.git/config` changes. Like `trust.json`, it stays
 * out of the clone and the vault, the places an agent edits.
 */
export class CloneOriginStore {
  private readonly path: string;
  private readonly origins: Record<string, StoredOrigin>;

  constructor(path: string) {
    this.path = path;
    const read = readJsonTolerant(path);
    this.origins = read.ok && isOriginMap(read.value) ? read.value : {};
  }

  /** Null when Eva has no record of the folder. */
  origin(cloneFolder: string): CloneOrigin | null {
    const stored = this.origins[cloneKey(cloneFolder)];
    if (stored === undefined) return null;
    // A marker that is gone or changed fails safe: the folder counts as replaced, never as trusted.
    if (readMarker(cloneFolder) !== stored.marker) return { kind: "replaced", url: stored.url };
    return stored.decision === undefined
      ? { kind: "cloned", url: stored.url }
      : { kind: "answered", url: stored.url, decision: stored.decision };
  }

  recordClone(cloneFolder: string, repositoryUrl: string): void {
    this.write(cloneFolder, repositoryUrl, undefined);
  }

  recordAnswer(cloneFolder: string, repositoryUrl: string, decision: "trusted" | "untrusted"): void {
    this.write(cloneFolder, repositoryUrl, decision);
  }

  private write(cloneFolder: string, url: string, decision: "trusted" | "untrusted" | undefined): void {
    const marker = writeMarker(cloneFolder);
    // With no git folder there is nothing to mark, and an unmarked record would never match.
    if (marker === null) return;
    this.origins[cloneKey(cloneFolder)] = decision === undefined ? { url, marker } : { url, marker, decision };
    writeFileAtomic(this.path, JSON.stringify(this.origins, null, 2) + "\n");
  }
}

/** One key per folder: Windows paths ignore case, so a vault path typed with another case still matches. */
function cloneKey(cloneFolder: string): string {
  const absolute = resolve(cloneFolder);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/**
 * The clone's git folder: `.git`, or the folder that a `.git` file names, as in a worktree.
 * A marker file, not the folder's inode and birth time: a file system can give both to a folder
 * made again at the same path, and some file systems keep no birth time at all.
 */
function gitFolder(cloneFolder: string): string | null {
  const dotGit = join(cloneFolder, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
    const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
    return pointer?.[1] === undefined ? null : resolve(cloneFolder, pointer[1]);
  } catch {
    return null;
  }
}

function readMarker(cloneFolder: string): string | null {
  const folder = gitFolder(cloneFolder);
  if (folder === null) return null;
  try {
    return readFileSync(join(folder, markerFileName), "utf8").trim();
  } catch {
    return null;
  }
}

/** A new marker on each record, so an old copy of a marker never matches a later record. */
function writeMarker(cloneFolder: string): string | null {
  const folder = gitFolder(cloneFolder);
  if (folder === null) return null;
  const marker = randomUUID();
  writeFileAtomic(join(folder, markerFileName), marker + "\n");
  return marker;
}

function isOriginMap(value: unknown): value is Record<string, StoredOrigin> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return false;
    const { url, marker, decision } = entry as { url?: unknown; marker?: unknown; decision?: unknown };
    return (
      typeof url === "string" &&
      typeof marker === "string" &&
      (decision === undefined || decision === "trusted" || decision === "untrusted")
    );
  });
}
