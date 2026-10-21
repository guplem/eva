/**
 * The Test buttons of the settings page: one real, small check for each
 * part Eva depends on. A check never shows a secret, even in its error text.
 */
import type { EngineName, EnginePort } from "../shared/engine-port.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import { checkGoogle, type GoogleCheckInputs } from "./google/google-check.ts";
import { engineLabels, ModelCalls } from "./model-calls/model-calls.ts";
import { firstOutputLine, shortVersion } from "./tool-versions.ts";

export type CheckName = "vault" | EngineName | "github" | "telegram" | "google";

export const checkNames: readonly CheckName[] = ["vault", "claude-code", "pi", "github", "telegram", "google"];

export interface CheckResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface CheckInputs {
  readonly vaultPath: string | null;
  readonly runner: ProcessRunner;
  /** Eva's git environment, with the GitHub token. */
  readonly environment: Readonly<Record<string, string>>;
  /** The engines that Eva found on this machine. */
  readonly engines: readonly EnginePort[];
  /** The environment of a real turn: the engine's login, and no GitHub token (lesson 96). */
  readonly engineEnvironment: Readonly<Record<string, string>>;
  readonly redact: (text: string) => string;
  readonly telegramToken: string | null;
  /** The Bot API address; a test points it at a fake server. */
  readonly telegramBaseUrl?: string;
  /** The token of Eva's git commands; null: the GitHub check asks gh instead. */
  readonly githubToken: string | null;
  /** The GitHub API address; a test points it at a fake server. */
  readonly githubBaseUrl?: string;
  /** A test makes it short. */
  readonly engineTimeoutMs?: number;
  readonly google: GoogleCheckInputs;
}

const checkTimeoutMs = 30_000;
/** A cold start of an engine and one short answer. */
const engineCheckTimeoutMs = 90_000;
const engineSystemPrompt = "You answer in one short line.";
const enginePrompt = "Reply with the single word OK.";
const replyPreviewLength = 80;

export async function runCheck(name: CheckName, inputs: CheckInputs): Promise<CheckResult> {
  if (name === "telegram") return checkTelegram(inputs);
  if (name === "google") return checkGoogleSetup(inputs);
  if (name === "github") return checkGithub(inputs);
  if (name === "claude-code" || name === "pi") return checkEngine(name, inputs);
  if (inputs.vaultPath === null) return { ok: false, detail: "No vault is configured." };
  // A dry-run push to a branch that does not exist checks write access: a read-only key passes
  // ls-remote, then every autosave fails (lesson 98). Nothing is sent.
  return runProgram(
    ["git", "push", "--dry-run", "origin", "HEAD:refs/heads/eva-access-check"],
    inputs.vaultPath,
    inputs.environment,
    inputs,
    "Eva can push to the vault's remote.",
  );
}

/** One real model call proves the program, the login and the model at once; `--version` proves only the program. */
async function checkEngine(name: EngineName, inputs: CheckInputs): Promise<CheckResult> {
  const calls = new ModelCalls({
    engines: inputs.engines,
    environment: inputs.engineEnvironment,
    redact: inputs.redact,
    timeoutMs: inputs.engineTimeoutMs ?? engineCheckTimeoutMs,
  });
  const result = await calls.ask({
    engine: name,
    model: "default",
    systemPrompt: engineSystemPrompt,
    prompt: enginePrompt,
  });
  if (!result.ok) return { ok: false, detail: result.reason };
  const preview = (result.text.trim().split(/\r?\n/)[0] ?? "").slice(0, replyPreviewLength);
  return { ok: true, detail: inputs.redact(`${engineLabels[name]} answered: ${preview}`) };
}

async function runProgram(
  command: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
  inputs: CheckInputs,
  okDetail: string | null,
): Promise<CheckResult> {
  try {
    const result = await inputs.runner.run(command, {
      cwd,
      environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: checkTimeoutMs,
    });
    const output = (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/)[0] ?? "";
    return result.exitCode === 0
      ? { ok: true, detail: inputs.redact(okDetail ?? output) }
      : { ok: false, detail: inputs.redact(result.stderr.trim().split(/\r?\n/)[0] ?? "failed") };
  } catch (error) {
    return { ok: false, detail: inputs.redact(error instanceof Error ? error.message : "failed") };
  }
}

/**
 * Eva's git commands use the saved token, so the token itself is what to check. The agents push
 * with the instance's gh, which the same login logs in (#244), so the check asks gh too.
 */
async function checkGithub(inputs: CheckInputs): Promise<CheckResult> {
  // One host only: an expired login to another host makes a plain `gh auth status` fail.
  const ghStatus = ["gh", "auth", "status", "--hostname", "github.com"];
  if (inputs.githubToken === null)
    return runProgram(ghStatus, process.cwd(), inputs.environment, inputs, "gh is logged in.");
  let account: string;
  try {
    const response = await fetch(`${inputs.githubBaseUrl ?? "https://api.github.com"}/user`, {
      headers: { authorization: `Bearer ${inputs.githubToken}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (!response.ok) return { ok: false, detail: "GitHub refused the token." };
    // A proxy can answer 200 with a page that is not JSON; the account name is then unknown.
    const body = (await response.json().catch(() => ({}))) as { login?: string };
    account = `@${body.login ?? "an unknown account"}`;
  } catch {
    return { ok: false, detail: "GitHub could not be reached." };
  }
  const gh = await runProgram(ghStatus, process.cwd(), inputs.environment, inputs, "");
  if (gh.ok) return { ok: true, detail: `The token belongs to ${account}. Your agents use the same login.` };
  // Eva logs gh in at the login and only writes a failure to the log, so a new login cannot fix a
  // missing or old gh. The check names it, or the person presses Log in again and again.
  const line = await firstOutputLine(["gh", "--version"], { runner: inputs.runner, environment: inputs.environment });
  if (line === null)
    return {
      ok: false,
      detail: `The token belongs to ${account}, but this machine has no gh, so your agents cannot push their work. Install gh from https://cli.github.com, then press Log in with GitHub again.`,
    };
  const version = shortVersion(line);
  if (olderThan(version, minimumGhVersion))
    return {
      ok: false,
      detail: `The token belongs to ${account}, but gh ${version} on this machine is too old for Eva's login. Install gh ${minimumGhVersion.join(".")} or newer from https://cli.github.com, then press Log in with GitHub again.`,
    };
  return {
    ok: false,
    detail: `The token belongs to ${account}, but your agents cannot push their work yet. Press Log in with GitHub again.`,
  };
}

/** The first gh with `auth login --insecure-storage`, which Eva's login uses. */
const minimumGhVersion: readonly number[] = [2, 40];

/** False when the version has no number: Eva cannot tell, so the login gets the blame as before. */
function olderThan(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return false;
  for (const [index, wanted] of minimum.entries()) {
    const part = parts[index] ?? 0;
    if (part !== wanted) return part < wanted;
  }
  return false;
}

async function checkTelegram(inputs: CheckInputs): Promise<CheckResult> {
  if (inputs.telegramToken === null) return { ok: false, detail: "No Telegram bot token is saved." };
  try {
    const baseUrl = inputs.telegramBaseUrl ?? "https://api.telegram.org";
    const response = await fetch(`${baseUrl}/bot${inputs.telegramToken}/getMe`, {
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    const body = (await response.json()) as { ok: boolean; result?: { username?: string } };
    return body.ok
      ? { ok: true, detail: `@${body.result?.username ?? "bot"}` }
      : { ok: false, detail: "Telegram refused the token." };
  } catch {
    return { ok: false, detail: "Telegram could not be reached." };
  }
}

/** A chat's engine starts the Google tools with `uvx`, so a working login without uv still fails in chats. */
async function checkGoogleSetup(inputs: CheckInputs): Promise<CheckResult> {
  const result = await checkGoogle(inputs.google);
  if (!result.ok) return { ok: false, detail: inputs.redact(result.detail) };
  const uv = await runProgram(["uvx", "--version"], process.cwd(), inputs.engineEnvironment, inputs, null);
  if (!uv.ok)
    return {
      ok: false,
      detail:
        "The Google login works, but this machine has no uv to run the Google tools. Run `eva setup` on the machine: it installs uv.",
    };
  return { ok: true, detail: inputs.redact(result.detail) };
}
