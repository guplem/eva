/**
 * The environments of the child processes of one instance: Eva's own git commands, the agents'
 * engines, and Eva's own engine tools. Each gets only what it needs (lesson 96).
 */
import { chmodSync } from "node:fs";
import { delimiter, join } from "node:path";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../../shared/environment.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import {
  engineFolders,
  engineFolderVariables,
  engineGitConfig,
  isExtraInstance,
  type EvaSecrets,
  type HomePaths,
} from "../settings/home.ts";
import { githubTokenVariable } from "../vault/vault-clone.ts";

export interface InstanceFacts {
  readonly paths: HomePaths;
  /** The environment Eva started with. Child processes only get its allowlisted part. */
  readonly processEnvironment: EnvironmentMap;
  /** The platform's default home folder; another home is an extra instance (lesson 111). */
  readonly defaultHome?: string;
  /** The `engines.claudeCode.ownConfigFolder` setting. */
  readonly ownClaudeConfigFolder: boolean;
  /** The command that starts this Eva, for the `eva` scripts of the agents. Null: no script. */
  readonly evaCommand?: readonly string[] | null;
}

/** Only Eva's own git commands get the GitHub token; an agent's environment never does (lesson 96). */
export function gitEnvironment(facts: InstanceFacts, secrets: EvaSecrets): Record<string, string> {
  const token = secrets.githubToken;
  return buildChildEnvironment(facts.processEnvironment, baseEnvironmentAllowlist, {
    // Eva's own `gh` calls (the GitHub check, pull requests) use this instance's login too.
    ...(isExtraInstance(facts.paths, facts.defaultHome) ? { GH_CONFIG_DIR: engineFolders(facts.paths).gh } : {}),
    ...(token === undefined ? {} : { [githubTokenVariable]: token }),
  });
}

/**
 * The git environment of a step that runs before the core starts, or with no Eva running: the
 * allowlist and the GitHub token, without the extra instance's `gh` folder.
 */
export function gitEnvironmentWithToken(
  processEnvironment: EnvironmentMap,
  secrets: EvaSecrets,
): Record<string, string> {
  const token = secrets.githubToken;
  return buildChildEnvironment(
    processEnvironment,
    baseEnvironmentAllowlist,
    token === undefined ? {} : { [githubTokenVariable]: token },
  );
}

/** The engine's environment: the allowlist, the Claude token, and own config folders for an extra instance. */
export function engineEnvironment(facts: InstanceFacts, secrets: EvaSecrets): Record<string, string> {
  const extraInstance = isExtraInstance(facts.paths, facts.defaultHome);
  const extra: Record<string, string> = {
    ...(extraInstance ? engineFolderVariables(engineFolders(facts.paths)) : {}),
    EVA_HOME: facts.paths.root,
  };
  if (extraInstance) {
    // An agent's own `git push` uses the instance's gh login, not the OS user's git login.
    const gitConfig = join(engineFolders(facts.paths).git, "gitconfig");
    writeFileAtomic(gitConfig, engineGitConfig(facts.processEnvironment, gitConfig));
    extra["GIT_CONFIG_GLOBAL"] = gitConfig;
  }
  const scripts = writeEvaScripts(facts);
  if (scripts !== null) {
    // The agent finds `eva` first, so `eva work` reaches this instance.
    const path = facts.processEnvironment["PATH"] ?? facts.processEnvironment["Path"] ?? "";
    extra["PATH"] = `${scripts}${delimiter}${path}`;
  }
  const token = secrets.claudeOauthToken;
  if (token !== undefined) extra["CLAUDE_CODE_OAUTH_TOKEN"] = token;
  const claudeFolder = claudeConfigFolder(facts);
  if (claudeFolder !== null) extra["CLAUDE_CONFIG_DIR"] = claudeFolder;
  return buildChildEnvironment(facts.processEnvironment, baseEnvironmentAllowlist, extra);
}

/**
 * The environment of Eva's own `claude` runs, such as `claude update`: the turns' config
 * folder, so the run acts on the same install, and no token, which such a run never needs.
 */
export function engineToolEnvironment(facts: InstanceFacts): Record<string, string> {
  const claudeFolder = claudeConfigFolder(facts);
  return buildChildEnvironment(
    facts.processEnvironment,
    baseEnvironmentAllowlist,
    claudeFolder === null ? {} : { CLAUDE_CONFIG_DIR: claudeFolder },
  );
}

/** The instance's own Claude config folder, or null for the OS user's own one. */
function claudeConfigFolder(facts: InstanceFacts): string | null {
  return isExtraInstance(facts.paths, facts.defaultHome) || facts.ownClaudeConfigFolder
    ? engineFolders(facts.paths).claude
    : null;
}

/** The folder of the `eva` scripts for agents, or null when Eva does not know her own command. */
function writeEvaScripts(facts: InstanceFacts): string | null {
  const command = facts.evaCommand ?? null;
  if (command === null || command.length === 0) return null;
  const folder = join(facts.paths.root, "bin");
  writeEvaScriptFiles(folder, command);
  return folder;
}

/** Writes `eva` (for a POSIX shell and Git Bash) and `eva.cmd` into `<home>/bin`. */
function writeEvaScriptFiles(folder: string, command: readonly string[]): void {
  const shellQuote = (part: string): string => `'${part.replaceAll("'", "'\\''")}'`;
  writeFileAtomic(join(folder, "eva"), `#!/bin/sh\nexec ${command.map(shellQuote).join(" ")} "$@"\n`);
  chmodSync(join(folder, "eva"), 0o755);
  writeFileAtomic(join(folder, "eva.cmd"), `@${command.map((part) => `"${part}"`).join(" ")} %*\r\n`);
}
