/**
 * The engine logins of an extra instance, for `eva setup`. An extra instance keeps its
 * Claude, pi and gh logins in its own folders (lesson 111), so the person logs in to each
 * engine once more for it. Setup prints each step and never runs a login itself: a login
 * reads the terminal, and the process seam captures the child's input and output.
 */
import { join } from "node:path";
import type { EngineFolders } from "../../core/settings/home.ts";
import { readJsonTolerant } from "../../shared/files.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

const ghTimeoutMs = 30_000;

export interface EngineLoginState {
  /** A saved token, which says nothing about whose Claude account it belongs to. */
  readonly claudeToken: boolean;
  /** "claude": pi holds an Anthropic login, which Eva never uses through pi. */
  readonly pi: "ok" | "missing" | "claude";
  readonly gh: boolean;
}

export interface EngineLoginStateOptions {
  readonly folders: EngineFolders;
  readonly claudeTokenSaved: boolean;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
}

export async function engineLoginState(options: EngineLoginStateOptions): Promise<EngineLoginState> {
  return {
    claudeToken: options.claudeTokenSaved,
    pi: piLoginState(options.folders.piAgent),
    gh: await ghLoggedIn(options),
  };
}

/** The explanation and one step for each missing login; none when every login is in place. */
export function engineLoginSteps(state: EngineLoginState, folders: EngineFolders, platform: NodeJS.Platform): string[] {
  const steps = [
    // First, so the person can log in before setup runs `gh repo create` for a new vault.
    ...(state.gh ? [] : [`- GitHub: ${ghStep(folders, platform)}`]),
    ...(state.claudeToken
      ? []
      : [
          "- Claude: run `claude setup-token`. A browser opens. Check that it is signed in to your own Claude account. Setup asks for the token below.",
        ]),
    ...(state.pi === "ok" ? [] : [`- pi: ${piStep(state.pi, folders, platform)}`]),
  ];
  if (steps.length === 0) return [];
  return [
    "This Eva is not in the default home. So it is a second Eva on this computer, for another person.",
    "It keeps its own logins for its engines: the AI tools Claude Code and pi, and the GitHub tool gh.",
    "So it never uses another person's account or subscription.",
    `Open another ${platform === "win32" ? "PowerShell window" : "terminal"}, and log in there. Setup keeps going while you do:`,
    ...steps,
  ];
}

/**
 * One line for each engine login: done, or what to run. `claudeTokenHint` says how to give
 * setup a new Claude token, which differs between a person and a script.
 */
export function engineLoginReport(
  state: EngineLoginState,
  folders: EngineFolders,
  claudeTokenHint: string,
  platform: NodeJS.Platform,
): string[] {
  const pi = {
    ok: "- pi: logged in.",
    missing: `- pi: not logged in. You need this only to chat with pi. ${piStep("missing", folders, platform)}`,
    claude: `- pi: ${piStep("claude", folders, platform)}`,
  }[state.pi];
  return [
    "Engine logins of this Eva:",
    state.claudeToken
      ? "- Claude: token saved."
      : `- Claude: no token yet. Run \`claude setup-token\`. Then ${claudeTokenHint}.`,
    pi,
    state.gh ? "- GitHub: logged in." : `- GitHub: not logged in. ${ghStep(folders, platform)}`,
  ];
}

/** The gh login command for this instance's gh folder. */
export function loginToGitHub(ghFolder: string, platform: NodeJS.Platform): string {
  // gh keeps its token in the system keyring under one name for every config folder, so a
  // second login there replaces the first person's. With this flag the token stays in the folder.
  return withVariable("GH_CONFIG_DIR", ghFolder, ["gh", "auth", "login", "--insecure-storage"], platform);
}

/** A command line that runs `command` with one variable set, in the platform's shell. */
export function withVariable(
  variable: string,
  value: string,
  command: readonly string[],
  platform: NodeJS.Platform,
): string {
  const quoted = quoteForShell(value, platform);
  // PowerShell is the Windows shell of the guide. Its `$env:` lasts for the whole window, so the line removes it again.
  if (platform === "win32") return `$env:${variable} = ${quoted}; ${command.join(" ")}; Remove-Item Env:${variable}`;
  return `${variable}=${quoted} ${command.join(" ")}`;
}

/** A single-quoted string for PowerShell on Windows, or for a POSIX shell. */
export function quoteForShell(value: string, platform: NodeJS.Platform): string {
  // PowerShell ends a single-quoted string at a curly quote too, and a doubled quote stays one quote.
  if (platform === "win32") return `'${value.replace(/['‘’‚‛]/g, (quote) => quote + quote)}'`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function ghStep(folders: EngineFolders, platform: NodeJS.Platform): string {
  // `gh auth setup-git` changes the OS user's global git settings, which every Eva shares.
  return `Run \`${loginToGitHub(folders.gh, platform)}\`. When gh asks to authenticate git, answer No.`;
}

function piStep(login: "missing" | "claude", folders: EngineFolders, platform: NodeJS.Platform): string {
  if (login === "claude") {
    return `pi has a Claude login. Run \`${runPi(folders, platform)}\`. Type /logout inside pi, then /login with another provider.`;
  }
  return `Run \`${runPi(folders, platform)}\`. Type /login inside pi. Never choose Anthropic: a Claude login in pi bills as extra usage.`;
}

function runPi(folders: EngineFolders, platform: NodeJS.Platform): string {
  return withVariable("PI_CODING_AGENT_DIR", folders.piAgent, ["pi"], platform);
}

/** The pi login in an agent folder: "claude" is an Anthropic login, which Eva never uses through pi. */
export function piLoginState(agentFolder: string): EngineLoginState["pi"] {
  const file = readJsonTolerant(join(agentFolder, "auth.json"));
  if (!file.ok || typeof file.value !== "object" || file.value === null) return "missing";
  const providers = Object.keys(file.value);
  if (providers.includes("anthropic")) return "claude";
  return providers.length > 0 ? "ok" : "missing";
}

async function ghLoggedIn(options: EngineLoginStateOptions): Promise<boolean> {
  try {
    // One host only: an expired login to another host makes a plain `gh auth status` fail.
    const result = await options.runner.run(["gh", "auth", "status", "--hostname", "github.com"], {
      cwd: process.cwd(),
      environment: { ...options.environment, GH_CONFIG_DIR: options.folders.gh, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: ghTimeoutMs,
    });
    return result.exitCode === 0;
  } catch {
    // No gh program, or gh hung: the person sees the login step, and setup goes on.
    return false;
  }
}
