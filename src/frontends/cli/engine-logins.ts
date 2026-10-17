/**
 * The engine logins of an extra instance, for `eva setup`. An extra instance keeps its
 * Claude, pi and gh logins in its own folders (lesson 111), so the person logs in to each
 * engine once more for it. Setup prints each step and never runs a login itself: a login
 * reads the terminal, and the process seam captures the child's input and output.
 */
import { join } from "node:path";
import { readJsonTolerant } from "../../shared/files.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

const ghTimeoutMs = 30_000;

/** A command line that runs `command` with one variable set, in the platform's shell. */
export function withVariable(
  variable: string,
  value: string,
  command: readonly string[],
  platform: NodeJS.Platform,
): string {
  // PowerShell is the Windows shell of the guide. Its `$env:` lasts for the whole window, so the line removes it again.
  if (platform === "win32") {
    return `$env:${variable} = '${value.replaceAll("'", "''")}'; ${command.join(" ")}; Remove-Item Env:${variable}`;
  }
  return `${variable}='${value.replaceAll("'", "'\\''")}' ${command.join(" ")}`;
}

/** The explanation and one login step for each engine; none for the first instance. */
export function engineLoginSteps(folders: Readonly<Record<string, string>>, platform: NodeJS.Platform): string[] {
  const pi = folders["PI_CODING_AGENT_DIR"];
  const gh = folders["GH_CONFIG_DIR"];
  if (pi === undefined || gh === undefined) return [];
  return [
    "This instance is not in the default home, so it is an extra instance, such as a second person's Eva.",
    "It keeps its own Claude, pi and GitHub logins in its engines folder, so it never uses another person's subscription.",
    "Log in to each engine for this instance. Use another terminal, then come back here:",
    `- Claude: run \`claude setup-token\`, and paste the token when setup asks for it. Check that the browser is signed in to your own Claude account.`,
    `- pi: run \`${withVariable("PI_CODING_AGENT_DIR", pi, ["pi"], platform)}\`, then type /login. Never choose Anthropic: a Claude login in pi bills as extra usage.`,
    `- GitHub: run \`${loginToGitHub(gh, platform)}\`.`,
  ];
}

export interface EngineLoginReportOptions {
  readonly folders: Readonly<Record<string, string>>;
  readonly claudeTokenSaved: boolean;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly platform: NodeJS.Platform;
}

/** One line for each engine login of an extra instance: done, or what to run. */
export async function engineLoginReport(options: EngineLoginReportOptions): Promise<string[]> {
  const pi = options.folders["PI_CODING_AGENT_DIR"];
  const gh = options.folders["GH_CONFIG_DIR"];
  if (pi === undefined || gh === undefined) return [];
  const piLogin = readJsonTolerant(join(pi, "auth.json"));
  const piLoggedIn =
    piLogin.ok && typeof piLogin.value === "object" && piLogin.value !== null && Object.keys(piLogin.value).length > 0;
  return [
    "Engine logins of this instance:",
    options.claudeTokenSaved
      ? "- Claude: logged in."
      : "- Claude: not logged in. Run `claude setup-token`, then run `eva setup` again and paste the token.",
    piLoggedIn
      ? "- pi: logged in."
      : `- pi: not logged in. Only pi chats need it. Run \`${withVariable("PI_CODING_AGENT_DIR", pi, ["pi"], options.platform)}\`, then type /login.`,
    (await ghLoggedIn(options))
      ? "- GitHub: logged in."
      : `- GitHub: not logged in. Run \`${loginToGitHub(gh, options.platform)}\`.`,
  ];
}

/** The gh login command for this instance's gh folder. */
export function loginToGitHub(ghFolder: string, platform: NodeJS.Platform): string {
  return withVariable("GH_CONFIG_DIR", ghFolder, ["gh", "auth", "login"], platform);
}

async function ghLoggedIn(options: EngineLoginReportOptions): Promise<boolean> {
  try {
    const result = await options.runner.run(["gh", "auth", "status"], {
      cwd: process.cwd(),
      environment: { ...options.environment, ...options.folders, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: ghTimeoutMs,
    });
    return result.exitCode === 0;
  } catch {
    // No gh program, or gh hung: the person sees the login step, and setup goes on.
    return false;
  }
}
