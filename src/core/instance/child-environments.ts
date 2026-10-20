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
  instanceNameOf,
  instanceVariable,
  type CommitIdentity,
  type EvaSecrets,
  type HomePaths,
} from "../settings/home.ts";
import { githubTokenVariable } from "../vault/vault-clone.ts";

export interface InstanceFacts {
  readonly paths: HomePaths;
  /** The environment Eva started with. Child processes only get its allowlisted part. */
  readonly processEnvironment: EnvironmentMap;
  /** The command that starts this Eva, for the `eva` scripts of the agents. Null: no script. */
  readonly evaCommand?: readonly string[] | null;
  /** The name and email of this instance's commits. Absent: git's own settings. */
  readonly commitIdentity?: CommitIdentity;
}

/** Only Eva's own git commands get the GitHub token; an agent's environment never does (lesson 96). */
export function gitEnvironment(facts: InstanceFacts, secrets: EvaSecrets): Record<string, string> {
  const token = secrets.githubToken;
  return buildChildEnvironment(facts.processEnvironment, baseEnvironmentAllowlist, {
    // Eva's own `gh` calls (the GitHub check, pull requests) use this instance's login too.
    GH_CONFIG_DIR: engineFolders(facts.paths).gh,
    ...(token === undefined ? {} : { [githubTokenVariable]: token }),
    ...commitIdentityVariables(facts.commitIdentity),
  });
}

/**
 * The git environment of a step that runs before the core starts, or with no Eva running: the
 * allowlist, the GitHub token and the commit identity, without the instance's `gh` folder.
 */
export function gitEnvironmentWithToken(
  processEnvironment: EnvironmentMap,
  secrets: EvaSecrets,
  identity?: CommitIdentity,
): Record<string, string> {
  const token = secrets.githubToken;
  return buildChildEnvironment(processEnvironment, baseEnvironmentAllowlist, {
    ...(token === undefined ? {} : { [githubTokenVariable]: token }),
    ...commitIdentityVariables(identity),
  });
}

/** Eva's own git reads no instance config file, so the variables carry the identity. A null part adds none. */
export function commitIdentityVariables(identity: CommitIdentity | undefined): Record<string, string> {
  const name = identity?.name ?? null;
  const email = identity?.email ?? null;
  return {
    ...(name === null ? {} : { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name }),
    ...(email === null ? {} : { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email }),
  };
}

/** The engine's environment: the allowlist, the Claude token, and the instance's own engine folders. */
export function engineEnvironment(facts: InstanceFacts, secrets: EvaSecrets): Record<string, string> {
  const folders = engineFolders(facts.paths);
  // An agent's own `git push` uses the instance's gh login, not the OS user's git login.
  const gitConfig = join(folders.git, "gitconfig");
  writeFileAtomic(gitConfig, engineGitConfig(facts.processEnvironment, gitConfig, facts.commitIdentity));
  const extra: Record<string, string> = {
    ...engineFolderVariables(folders),
    GIT_CONFIG_GLOBAL: gitConfig,
    // The agent's `eva` commands reach this instance. EVA_HOME tells the agent where the logs are.
    [instanceVariable]: instanceNameOf(facts.paths),
    EVA_HOME: facts.paths.root,
  };
  const scripts = writeEvaScripts(facts);
  if (scripts !== null) {
    // The agent finds `eva` first, so `eva work` runs this Eva's program.
    const path = facts.processEnvironment["PATH"] ?? facts.processEnvironment["Path"] ?? "";
    extra["PATH"] = `${scripts}${delimiter}${path}`;
  }
  const token = secrets.claudeOauthToken;
  if (token !== undefined) extra["CLAUDE_CODE_OAUTH_TOKEN"] = token;
  return buildChildEnvironment(facts.processEnvironment, baseEnvironmentAllowlist, extra);
}

/**
 * The environment of Eva's own `claude` runs, such as `claude update`: the turns' config
 * folder, so the run acts on the same install, and no token, which such a run never needs.
 */
export function engineToolEnvironment(facts: InstanceFacts): Record<string, string> {
  return buildChildEnvironment(facts.processEnvironment, baseEnvironmentAllowlist, {
    CLAUDE_CONFIG_DIR: engineFolders(facts.paths).claude,
  });
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
