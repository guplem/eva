/**
 * The gh login of an instance, which her agents use to push and to open pull requests. Eva logs
 * it in with her own GitHub token, so one login serves Eva and her agents (#244). It lives in the
 * instance's own gh folder, never in the person's own gh login (lesson 111).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { writeFileAtomic } from "../../shared/files.ts";
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

/**
 * Logs out every github.com account of the instance's gh, by removing it from gh's file. No gh
 * process: `gh auth logout` also deletes the account from the system keyring, which the person's
 * own gh and other instances share. Returns why it failed, or null.
 */
export function logOutGitHubCli(ghFolder: string): string | null {
  const file = join(ghFolder, "hosts.yml");
  if (!existsSync(file)) return null;
  try {
    const hosts = parseDocument(readFileSync(file, "utf8"));
    // A file that Eva cannot read is not hers to rewrite.
    if (hosts.errors.length > 0) return `Eva could not read ${file}: ${hosts.errors[0]?.message ?? ""}`;
    if (!hosts.has("github.com")) return null;
    hosts.delete("github.com");
    writeFileAtomic(file, hosts.toString());
    return null;
  } catch (error) {
    return `Eva could not change ${file}: ${error instanceof Error ? error.message : String(error)}`;
  }
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
