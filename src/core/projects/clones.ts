/**
 * Clones live in `Projects/<project>/repos/<repo>-<n>/`. Each one is
 * a parallel workspace. Trust decides whether a clone's own hooks and MCP servers may
 * run.
 */
import { githubCredentialArguments } from "../vault/vault-clone.ts";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

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

/** The clones of a project, sorted by repository and number. */
export function listClones(projectPath: string): Clone[] {
  const reposFolder = join(projectPath, "repos");
  if (!existsSync(reposFolder)) return [];
  const clones: Clone[] = [];
  for (const name of readdirSync(reposFolder)) {
    const match = cloneNamePattern.exec(name);
    const path = join(reposFolder, name);
    if (!match || !statSync(path).isDirectory()) continue;
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
}

/** Clones the repository into the next free folder. */
export async function createClone(options: CreateCloneOptions): Promise<Clone> {
  const repository = repositoryName(options.repositoryUrl);
  const name = cloneFolderName(options.projectPath, repository);
  const reposFolder = join(options.projectPath, "repos");
  const path = join(reposFolder, name);
  // Eva's credential helper, so a private project repository clones with the GitHub token too.
  const result = await options.runner.run(
    ["git", ...githubCredentialArguments, "clone", "-q", options.repositoryUrl, path],
    {
      cwd: options.projectPath,
      environment: { ...options.environment, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: cloneTimeoutMs,
    },
  );
  if (result.exitCode !== 0) {
    throw new EvaError("git_failed", `Could not clone ${options.repositoryUrl}: ${result.stderr.trim()}`);
  }
  return { name, path, repository, index: Number(name.slice(repository.length + 1)) };
}

export interface CloneDetails extends Clone {
  readonly branch: string | null;
  /** The number of the open pull request of the branch, when `gh` finds one. */
  readonly pullRequest: number | null;
}

/** A clone with its current branch and pull request, for the project view. */
export async function describeClone(
  clone: Clone,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<CloneDetails> {
  const options = { cwd: clone.path, environment: { ...environment, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 20_000 };
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

/** True when the repository's owner is on the allowlist (default trust). GitHub only. */
export function isTrustedByDefault(repositoryUrl: string, trustedOwners: readonly string[]): boolean {
  // Anchored at the start: `https://evil.example/github.com/<owner>/` must not count as GitHub.
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\//i.exec(
    repositoryUrl,
  );
  const owner = match?.[1]?.toLowerCase();
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
    writeFileAtomic(this.path, JSON.stringify(this.decisions, null, 2) + "\n");
  }
}

function isDecisionMap(value: unknown): value is Record<string, "trusted" | "untrusted"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry === "trusted" || entry === "untrusted");
}
