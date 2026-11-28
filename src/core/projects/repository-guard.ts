/**
 * The check before each git call that Eva makes herself in a repository of a clone (#1131). A
 * Project chat can write some git files of its clone, and Eva's git runs outside the sandbox,
 * with the GitHub token. So Eva refuses a repository whose git data could make her git start a
 * program that the chat chose, and forces safe settings on every other call.
 */
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const booleanValue = /^(true|false|yes|no|on|off|1|0)?$/i;

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
  // A hooks folder that does not exist: the repository's hooks are its code, and so is a husky folder.
  const noHooks = join(tmpdir(), `eva-no-hooks-${randomUUID()}`);
  const safe = withGitConfig({ ...environment, ...ownGitVariables, GIT_TERMINAL_PROMPT: "0" }, [
    ...ownGitConfig,
    ["core.hooksPath", noHooks],
  ]);
  // Listing the settings reads them and starts no program, so it is safe in any repository.
  const listed = await runner.run(["git", "config", "--list", "--show-scope", "-z"], {
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
  return safe as GuardedEnvironment;
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
  return null;
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

/**
 * The first setting of the repository's own config that names a program or sends git elsewhere,
 * or null. `listed` is the output of `git config --list --show-scope -z`. Only the `local` and
 * `worktree` scopes come from the repository. The person's global and system settings are theirs.
 */
export function programSetting(listed: string): string | null {
  const fields = listed.split("\0");
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const scope = fields[index] ?? "";
    if (scope !== "local" && scope !== "worktree") continue;
    const entry = fields[index + 1] ?? "";
    const newline = entry.indexOf("\n");
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? "" : entry.slice(newline + 1);
    if (namesProgram(key, value)) return key;
  }
  return null;
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
    case "submodule":
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
