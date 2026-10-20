/**
 * The gh login of an instance, which her agents use to push and to open pull requests. Eva logs
 * it in with her own GitHub token, so one login serves Eva and her agents (#244). It lives in the
 * instance's own gh folder, never in the person's own gh login (lesson 111).
 */
import { githubCliAccount } from "../setup/logins.ts";
import { baseEnvironmentAllowlist, buildChildEnvironment, type EnvironmentMap } from "../../shared/environment.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

export interface GitHubCliOptions {
  /** The instance's gh folder, from `engineFolders`. */
  readonly ghFolder: string;
  readonly runner: ProcessRunner;
  /** The environment Eva started with. The child gets only its allowlisted part. */
  readonly environment: EnvironmentMap;
}

// gh checks the token against GitHub, so it needs the network.
const timeoutMs = 30_000;

/** Logs in the instance's gh with the token. Returns why it failed, or null. */
export async function logInGitHubCli(options: GitHubCliOptions & { readonly token: string }): Promise<string | null> {
  // The token goes on stdin: an argument shows in the process list. A pasted one may end in "\r\n".
  const token = options.token.trim();
  return runGh(
    options,
    ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--with-token", "--insecure-storage"],
    `${token}\n`,
  );
}

/** Logs out the account of the instance's gh, when it has one. Returns why it failed, or null. */
export async function logOutGitHubCli(options: GitHubCliOptions): Promise<string | null> {
  const account = githubCliAccount(options.ghFolder);
  if (account === null) return null;
  // With more than one account, gh asks which one, and nobody is there to answer.
  return runGh(options, ["auth", "logout", "--hostname", "github.com", "--user", account]);
}

async function runGh(options: GitHubCliOptions, args: readonly string[], stdin?: string): Promise<string | null> {
  // gh refuses to log in while GH_TOKEN or GITHUB_TOKEN holds a token; the allowlist leaves both out.
  const environment = buildChildEnvironment(options.environment, baseEnvironmentAllowlist, {
    GH_CONFIG_DIR: options.ghFolder,
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0",
  });
  try {
    const result = await options.runner.run(["gh", ...args], {
      cwd: process.cwd(),
      environment,
      timeoutMs,
      ...(stdin === undefined ? {} : { stdin }),
    });
    if (result.exitCode === 0) return null;
    return `gh ${args.slice(0, 2).join(" ")} failed: ${(result.stderr.trim() || result.stdout.trim()).slice(0, 500)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
