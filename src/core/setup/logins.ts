/**
 * Whether each engine has a login, read from its own files. Most logins read the terminal or open
 * a browser, so Eva reads their files instead. The Claude login from the page is in `claude-login.ts`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
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
