/**
 * The Test buttons of the settings page: one real, small check for each
 * part Eva depends on. A check never shows a secret, even in its error text.
 */
import type { EngineName, EnginePort } from "../shared/engine-port.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";
import { engineLabels, ModelCalls } from "./model-calls/model-calls.ts";

export type CheckName = "vault" | EngineName | "github" | "telegram";

export const checkNames: readonly CheckName[] = ["vault", "claude-code", "pi", "github", "telegram"];

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
}

const checkTimeoutMs = 30_000;
/** A cold start of an engine and one short answer. */
const engineCheckTimeoutMs = 90_000;
const engineSystemPrompt = "You answer in one short line.";
const enginePrompt = "Reply with the single word OK.";
const replyPreviewLength = 80;

export async function runCheck(name: CheckName, inputs: CheckInputs): Promise<CheckResult> {
  if (name === "telegram") return checkTelegram(inputs);
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

/** Eva's git commands use the saved token, not gh's login, so the token itself is what to check. */
async function checkGithub(inputs: CheckInputs): Promise<CheckResult> {
  if (inputs.githubToken === null)
    return runProgram(["gh", "auth", "status"], process.cwd(), inputs.environment, inputs, "gh is logged in.");
  try {
    const response = await fetch(`${inputs.githubBaseUrl ?? "https://api.github.com"}/user`, {
      headers: { authorization: `Bearer ${inputs.githubToken}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (!response.ok) return { ok: false, detail: "GitHub refused the token." };
    // A proxy can answer 200 with a page that is not JSON; the account name is then unknown.
    const body = (await response.json().catch(() => ({}))) as { login?: string };
    return { ok: true, detail: `The token belongs to @${body.login ?? "an unknown account"}.` };
  } catch {
    return { ok: false, detail: "GitHub could not be reached." };
  }
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
