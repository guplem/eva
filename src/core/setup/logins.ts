/**
 * Whether each engine has a login, read from its own files. Most logins read the terminal or open
 * a browser, so Eva reads their files instead. The Claude login from the page is in `claude-login.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { readJsonTolerant } from "../../shared/files.ts";

/** "claude": pi holds an Anthropic login, which Eva never uses through pi. */
export type PiLogin = "ok" | "missing" | "claude";

/** The pi login in an agent folder. */
export function piLoginState(agentFolder: string): PiLogin {
  const file = readJsonTolerant(join(agentFolder, "auth.json"));
  if (!file.ok || typeof file.value !== "object" || file.value === null) return "missing";
  const providers = Object.keys(file.value);
  if (providers.includes("anthropic")) return "claude";
  return providers.length > 0 ? "ok" : "missing";
}

/**
 * Claude Code's own login, from `claude` in a terminal, in its config folder. macOS keeps that
 * login in the keychain instead, out of sight; a saved token counts there.
 */
export function claudeLoggedIn(configFolder: string): boolean {
  return existsSync(join(configFolder, ".credentials.json"));
}

/**
 * The account of the instance's gh login, from the file that `gh auth login --insecure-storage`
 * writes. Null: no github.com login, or a file that Eva cannot read.
 */
export function githubCliAccount(ghFolder: string): string | null {
  const user = githubHost(ghFolder)?.["user"];
  return typeof user === "string" && user !== "" ? user : null;
}

/**
 * The gh accounts whose token sits in the instance's file. An account without one keeps its token
 * in the system keyring, which the person's own gh and other instances share.
 */
export function githubCliFileAccounts(ghFolder: string): string[] {
  const host = githubHost(ghFolder);
  if (host === null) return [];
  const users = host["users"];
  // gh before 2.40 kept one account per host, with no `users` map.
  if (typeof users !== "object" || users === null) {
    const user = githubCliAccount(ghFolder);
    return user !== null && typeof host["oauth_token"] === "string" ? [user] : [];
  }
  return Object.entries(users as Record<string, unknown>).flatMap(([name, entry]) =>
    typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>)["oauth_token"] === "string"
      ? [name]
      : [],
  );
}

function githubHost(ghFolder: string): Record<string, unknown> | null {
  let hosts: unknown;
  try {
    hosts = parse(readFileSync(join(ghFolder, "hosts.yml"), "utf8"));
  } catch {
    return null;
  }
  if (typeof hosts !== "object" || hosts === null) return null;
  const github = (hosts as Record<string, unknown>)["github.com"];
  return typeof github === "object" && github !== null ? (github as Record<string, unknown>) : null;
}
