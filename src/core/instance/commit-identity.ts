/**
 * The name and email of an instance's commits. Each Eva signs as her own person, never as the
 * computer user's global git settings, so two people on one computer never sign each other's work.
 */
import { rmSync } from "node:fs";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { CommitIdentity, EvaConfig, HomePaths } from "../settings/home.ts";
import { readGitHubAccount, type GitHubAccount } from "../vault/github-repositories.ts";

/** The account record, or null when there is none or it is broken. */
export function loadGitHubAccount(paths: HomePaths): GitHubAccount | null {
  const read = readJsonTolerant(paths.githubAccount);
  if (!read.ok || typeof read.value !== "object" || read.value === null) return null;
  const { id, login, name } = read.value as Record<string, unknown>;
  if (typeof id !== "number" || typeof login !== "string") return null;
  return { id, login, name: typeof name === "string" ? name : null };
}

/** Saves the account record; null removes it, so a removed login takes its identity with it. */
export function saveGitHubAccount(paths: HomePaths, account: GitHubAccount | null): void {
  if (account === null) rmSync(paths.githubAccount, { force: true });
  else writeFileAtomic(paths.githubAccount, JSON.stringify(account, null, 2) + "\n");
}

/**
 * Reads the token's account and saves it. Eva calls this only when a login happens, never at
 * start, so she starts offline. A failed read keeps the old record and returns false.
 * `isCurrent`: false when the token changed during the read, whose account then is no longer wanted.
 */
export async function refreshGitHubAccount(
  paths: HomePaths,
  token: string,
  options: { readonly baseUrl?: string; readonly isCurrent?: () => boolean } = {},
): Promise<boolean> {
  let account: GitHubAccount;
  try {
    account = await readGitHubAccount({
      token,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    });
  } catch {
    return false;
  }
  if (options.isCurrent?.() === false) return false;
  saveGitHubAccount(paths, account);
  return true;
}

/** The person's own name and email first, then the GitHub account's. */
export function commitIdentity(paths: HomePaths, config: EvaConfig): CommitIdentity {
  const account = loadGitHubAccount(paths);
  const name = config.git.name ?? account?.name ?? account?.login ?? null;
  // GitHub links this private address to the account, and it never shows the person's real one.
  const email =
    config.git.email ?? (account === null ? null : `${String(account.id)}+${account.login}@users.noreply.github.com`);
  return { name: oneLine(name), email: oneLine(email) };
}

/** A line break would end the value in git's config file and start a new setting. */
function oneLine(value: string | null): string | null {
  if (value === null) return null;
  const line = value.replaceAll(/[\r\n]+/g, " ").trim();
  return line === "" ? null : line;
}
