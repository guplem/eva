/**
 * Eva clones the person's vault herself: setup needs only the repository and, for
 * an HTTPS address, a GitHub token. The token never goes into a URL or a git config file: a
 * credential helper reads it from `EVA_GITHUB_TOKEN`, which Eva puts only in the environment
 * of her own git commands, never in an agent's (lesson 96).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

/** The environment variable that holds the GitHub token for Eva's git commands. */
export const githubTokenVariable = "EVA_GITHUB_TOKEN";

const credentialKey = "credential.https://github.com.helper";
const credentialHelper = `!f() { test "$1" = get && echo username=x-access-token && echo "password=$${githubTokenVariable}"; }; f`;
const cloneTimeoutMs = 10 * 60_000;
const configTimeoutMs = 20_000;
const checkTimeoutMs = 60_000;

/** git options for one command: no other helper (such as a desktop login window), then Eva's. */
export const githubCredentialArguments: readonly string[] = [
  "-c",
  `${credentialKey}=`,
  "-c",
  `${credentialKey}=${credentialHelper}`,
];

export interface VaultCloneInputs {
  readonly repository: string;
  readonly folder: string;
  readonly runner: ProcessRunner;
  /** Eva's git environment; it holds `EVA_GITHUB_TOKEN` when a token is set. */
  readonly environment: Readonly<Record<string, string>>;
}

/**
 * Asks git whether it can read the repository with Eva's credentials, before setup clones it.
 * Returns null when it can, or git's reason when it cannot (a wrong address or token).
 */
export async function checkVaultRepository(inputs: Omit<VaultCloneInputs, "folder">): Promise<string | null> {
  const result = await inputs.runner.run(
    ["git", ...githubCredentialArguments, "ls-remote", "-q", inputs.repository, "HEAD"],
    { cwd: process.cwd(), environment: { ...inputs.environment, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: checkTimeoutMs },
  );
  if (result.exitCode === 0) return null;
  return result.stderr.trim() || `git ended with exit code ${String(result.exitCode)}.`;
}

/** Clones the vault into an empty or missing folder, and keeps Eva's credential helper in the clone. */
export async function cloneVault(inputs: VaultCloneInputs): Promise<void> {
  if (existsSync(inputs.folder) && readdirSync(inputs.folder).length > 0) {
    throw new EvaError("vault_not_found", `${inputs.folder} is not empty, so Eva does not clone the vault there.`);
  }
  const environment = { ...inputs.environment, GIT_TERMINAL_PROMPT: "0" };
  const clone = await inputs.runner.run(
    ["git", ...githubCredentialArguments, "clone", "-q", inputs.repository, inputs.folder],
    { cwd: process.cwd(), environment, timeoutMs: cloneTimeoutMs },
  );
  if (clone.exitCode !== 0) {
    throw new EvaError("git_failed", `git could not clone ${inputs.repository}: ${clone.stderr.trim()}`);
  }
  await keepCredentialHelper(inputs.folder, inputs.runner, environment);
}

/**
 * Pushes a new local vault to an empty repository, such as one that setup just made on GitHub.
 * A rerun after a failed push repeats each step safely: it never adds a second remote, and never forces.
 */
export async function pushNewVault(inputs: VaultCloneInputs): Promise<void> {
  const environment = { ...inputs.environment, GIT_TERMINAL_PROMPT: "0" };
  const run = (args: readonly string[], timeoutMs: number): ReturnType<ProcessRunner["run"]> =>
    inputs.runner.run(["git", ...args], { cwd: inputs.folder, environment, timeoutMs });
  const origin = await run(["remote", "get-url", "origin"], configTimeoutMs);
  const remote = await run(
    origin.exitCode === 0
      ? ["remote", "set-url", "origin", inputs.repository]
      : ["remote", "add", "origin", inputs.repository],
    configTimeoutMs,
  );
  if (remote.exitCode !== 0) {
    throw new EvaError("git_failed", `git could not add ${inputs.repository} as the remote: ${remote.stderr.trim()}`);
  }
  await keepCredentialHelper(inputs.folder, inputs.runner, environment);
  // HEAD, not main: a vault that the person made by hand can be on another branch, such as master.
  const push = await run([...githubCredentialArguments, "push", "-q", "-u", "origin", "HEAD"], cloneTimeoutMs);
  if (push.exitCode !== 0) {
    throw new EvaError("git_failed", `git could not push the vault to ${inputs.repository}: ${push.stderr.trim()}`);
  }
}

/**
 * True for a git vault with a commit and no remote: a new vault that had no GitHub login yet.
 * A rerun of setup then offers the push. A vault with a remote needs none: sync pushes to it,
 * and Eva never replaces a remote that the person chose.
 */
export async function vaultNeedsPush(inputs: Omit<VaultCloneInputs, "repository">): Promise<boolean> {
  // The folder itself must be the repository, not a folder inside another one.
  if (!existsSync(join(inputs.folder, ".git"))) return false;
  const run = (args: readonly string[]): ReturnType<ProcessRunner["run"]> =>
    inputs.runner.run(["git", ...args], {
      cwd: inputs.folder,
      environment: { ...inputs.environment, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: configTimeoutMs,
    });
  // With no commit, the push would fail after GitHub already made the repository.
  const commit = await run(["rev-parse", "-q", "--verify", "HEAD"]);
  if (commit.exitCode !== 0 || commit.stdout.trim() === "") return false;
  const remotes = await run(["remote"]);
  return remotes.exitCode === 0 && remotes.stdout.trim() === "";
}

/** Kept in the clone, so every later pull and push finds the token the same way. */
async function keepCredentialHelper(
  folder: string,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<void> {
  const config = (args: readonly string[]): ReturnType<ProcessRunner["run"]> =>
    runner.run(["git", "config", "--local", ...args], { cwd: folder, environment, timeoutMs: configTimeoutMs });
  // A rerun adds no second copy. A helper that the person set stays in the file.
  const current = await config(["--get-all", credentialKey]);
  if (current.stdout.includes(credentialHelper)) return;
  for (const value of ["", credentialHelper]) await config(["--add", credentialKey, value]);
}
