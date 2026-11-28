/**
 * The check before each git call that Eva makes herself in a repository of a clone (#1131). A
 * Project chat can write some git files of its clone, and Eva's git runs outside the sandbox,
 * with the GitHub token. So Eva refuses a repository whose git data could make her git start a
 * program that the chat chose, and forces safe settings on every other call.
 */
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { ownGitConfig, ownGitVariables, withGitConfig } from "../../shared/git-config.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";

declare const guarded: unique symbol;

/**
 * The environment of a git call in a repository that passed the guard. Only `guardRepository`
 * makes one, so a git helper that takes it cannot run in a repository that skipped the guard.
 */
export type GuardedEnvironment = Readonly<Record<string, string>> & { readonly [guarded]: true };

const listTimeoutMs = 20_000;

/**
 * The exact settings that `git lfs install --local` writes. LFS names a program that is on the
 * computer, not one in the repository, so these pass. Any other text is a program of the repository.
 */
const lfsFilter: Readonly<Record<string, string>> = {
  "filter.lfs.clean": "git-lfs clean -- %f",
  "filter.lfs.smudge": "git-lfs smudge -- %f",
  "filter.lfs.process": "git-lfs filter-process",
};

/** The values that git reads as a boolean: `core.fsmonitor` then means its own monitor, no program. */
const booleanValue = /^(true|false|yes|no|on|off|-?\d+)?$/i;

/** A hooks folder that does not exist: the repository's hooks are its code, and so is a husky folder. */
const missingHooksFolder = join(tmpdir(), `eva-no-hooks-${randomUUID()}`);

/** The settings that the guard forces on each git call in a repository of a clone. */
const guardedConfig = [...ownGitConfig, ["core.hooksPath", missingHooksFolder]] as const;

/**
 * The same settings as `-c` arguments, for each git call in a repository that passed the guard.
 * Git before 2.31 reads no `GIT_CONFIG_COUNT`, but every git reads these, and passes them on to
 * the git that it starts in a submodule.
 */
export function guardedArguments(): string[] {
  return guardedConfig.flatMap(([key, value]) => ["-c", `${key}=${value}`]);
}

/** The `ignore` values of a submodule that keep git from starting a git inside it. */
const submoduleKeptOut = new Set(["dirty", "all"]);

/**
 * Checks the repository, and gives the environment for its git calls. Throws EvaError
 * `repository_refused` when the repository's git data could start a program that Eva did not
 * choose. The message names the repository's folder, never the path of the vault.
 */
export async function guardRepository(
  repository: { readonly name: string; readonly path: string },
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<GuardedEnvironment> {
  const layout = layoutProblem(repository.path);
  if (layout !== null) throw new EvaError("repository_refused", `Eva runs no git in ${repository.name}: ${layout}`);
  const safe = withGitConfig(
    {
      ...environment,
      ...ownGitVariables,
      GIT_TERMINAL_PROMPT: "0",
      // A `.git` folder that git does not accept would make git search the folders above, up to the vault.
      GIT_CEILING_DIRECTORIES: dirname(repository.path),
    },
    guardedConfig,
  );
  // Listing the settings reads them and starts no program, so it is safe in any repository. `--local`
  // is every setting of the repository: the layout check refuses a `commondir` and a `config.worktree`.
  const listed = await runner.run(["git", ...guardedArguments(), "config", "--local", "--includes", "--list", "-z"], {
    cwd: repository.path,
    environment: safe,
    timeoutMs: listTimeoutMs,
  });
  if (listed.exitCode !== 0)
    throw new EvaError(
      "git_failed",
      `Could not read the git settings of ${repository.name}: ${failureReason(listed, "git")}`,
    );
  const key = programSetting(listed.stdout);
  if (key !== null)
    throw new EvaError(
      "repository_refused",
      `Eva runs no git in ${repository.name}: its own git settings name a program (${key}). ` +
        "Move the setting to your global git config, or remove it from the repository.",
    );
  const submodule = await submoduleSetting(repository, runner, safe);
  if (submodule !== null)
    throw new EvaError(
      "repository_refused",
      `Eva runs no git in ${repository.name}: its submodule settings make git work inside a submodule (${submodule}). ` +
        "Set it to dirty or all, or remove it.",
    );
  return safe as GuardedEnvironment;
}

/**
 * The first `submodule.<name>.ignore` of the repository's `.gitmodules` that makes git start a git
 * inside the submodule, or null. Such a git reads the submodule's own config, which a chat can write.
 * Git reads `.gitmodules` from the folder, else from the index, else from the last commit, so the
 * check reads each one that exists.
 */
async function submoduleSetting(
  repository: { readonly path: string },
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<string | null> {
  const options = { cwd: repository.path, environment, timeoutMs: listTimeoutMs };
  const sources: string[][] = [];
  if (entryKind(join(repository.path, ".gitmodules")) !== "absent") sources.push(["--file", ".gitmodules"]);
  const blobs = await runner.run(["git", ...guardedArguments(), "cat-file", "--batch-check"], {
    ...options,
    stdin: ":.gitmodules\nHEAD:.gitmodules\n",
  });
  for (const line of blobs.stdout.split(/\r?\n/)) {
    const [id, type] = line.split(" ");
    if (type === "blob" && id !== undefined) sources.push(["--blob", id]);
  }
  for (const source of sources) {
    const listed = await runner.run(["git", ...guardedArguments(), "config", ...source, "--list", "-z"], options);
    for (const [key, value] of entries(listed.stdout)) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("submodule.") &&
        lower.endsWith(".ignore") &&
        !submoduleKeptOut.has(value.trim().toLowerCase())
      )
        return key;
    }
  }
  return null;
}

/**
 * Why the git folder is not a plain folder of the repository's own, or null. A `.git` file, a
 * link, a `commondir` or a `config.worktree` makes git read settings from a place that the chat
 * may have written. Eva makes no worktree clone herself.
 */
function layoutProblem(path: string): string | null {
  const gitFolder = join(path, ".git");
  const kind = entryKind(gitFolder);
  if (kind !== "folder") return "its git data is not a plain folder inside it.";
  if (
    entryKind(join(gitFolder, "commondir")) !== "absent" ||
    entryKind(join(gitFolder, "config.worktree")) !== "absent"
  )
    return "its git data points to git data in another place.";
  if (entryKind(join(gitFolder, "config")) !== "file") return "its git config is not a plain file.";
  // Git skips a git folder that it does not accept and reads the one above, which can be the vault.
  if (
    !validHead(join(gitFolder, "HEAD")) ||
    entryKind(join(gitFolder, "objects")) !== "folder" ||
    entryKind(join(gitFolder, "refs")) !== "folder"
  )
    return "its git data is not a whole repository.";
  return null;
}

/** True for a `HEAD` file that names a branch or a commit, as git wants it. */
function validHead(path: string): boolean {
  if (entryKind(path) !== "file") return false;
  try {
    return /^(ref: refs\/\S+|[0-9a-f]{40}|[0-9a-f]{64})\s*$/.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

function entryKind(path: string): "file" | "folder" | "other" | "absent" {
  try {
    const entry = lstatSync(path);
    if (entry.isFile()) return "file";
    return entry.isDirectory() ? "folder" : "other";
  } catch {
    return "absent";
  }
}

/** The key and value of each setting in the output of `git config --list -z`. */
function entries(listed: string): [key: string, value: string][] {
  return listed
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const newline = entry.indexOf("\n");
      return newline === -1 ? [entry, ""] : [entry.slice(0, newline), entry.slice(newline + 1)];
    });
}

/**
 * The first setting of the repository's own config that names a program or sends git elsewhere,
 * or null. `listed` is the output of `git config --local --includes --list -z`. The person's
 * global and system settings are theirs, so the check reads only the repository's own.
 */
function programSetting(listed: string): string | null {
  return entries(listed).find(([key, value]) => namesProgram(key, value))?.[0] ?? null;
}

/**
 * True for a setting that makes git start a program, or send its data and the token elsewhere.
 * The list follows `git help --config`. Git prints the section and the last part in lower case.
 */
function namesProgram(key: string, value: string): boolean {
  const lower = key.toLowerCase();
  const first = lower.indexOf(".");
  const last = lower.lastIndexOf(".");
  const section = lower.slice(0, first);
  const leaf = lower.slice(last + 1);
  const named = last > first;
  switch (section) {
    case "core":
      if (leaf === "fsmonitor") return !booleanValue.test(value.trim());
      return ["sshcommand", "gitproxy", "worktree", "askpass", "alternaterefscommand"].includes(leaf);
    case "filter":
      return named && ["clean", "smudge", "process"].includes(leaf) && lfsFilter[lower] !== value;
    case "diff":
      return named ? ["command", "textconv"].includes(leaf) : leaf === "external";
    case "gc":
      return leaf === "recentobjectshook";
    case "merge":
      return named && leaf === "driver";
    case "difftool":
    case "mergetool":
      return named && ["cmd", "path"].includes(leaf);
    case "guitool":
      return named && leaf === "cmd";
    case "credential":
      return leaf === "helper";
    case "gpg":
      return leaf === "program" || leaf === "defaultkeycommand";
    case "remote":
      return named && ["uploadpack", "receivepack", "vcs", "proxy"].includes(leaf);
    case "url":
      return named && (leaf === "insteadof" || leaf === "pushinsteadof");
    case "http":
      return ["proxy", "sslverify", "sslcainfo", "sslcapath"].includes(leaf);
    case "protocol":
      return leaf === "allow";
    case "lfs":
      // Git LFS runs these programs when it cleans, smudges or moves a file.
      return lower === "lfs.standalonetransferagent" || (named && ["path", "clean", "smudge"].includes(leaf));
    case "submodule":
      if (named && leaf === "ignore") return !submoduleKeptOut.has(value.trim().toLowerCase());
      // Only a value that starts with `!` is a command. `rebase` or `merge` is no program.
      return named && leaf === "update" && value.trim().startsWith("!");
    case "pager":
    case "include":
    case "includeif":
      return true;
    default:
      return false;
  }
}
