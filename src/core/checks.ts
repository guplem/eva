/**
 * The Test buttons of the settings page (docs/plan.md §8.3): one real, small check for each
 * part Eva depends on. A check never shows a secret, even in its error text.
 */
import type { ProcessRunner } from "../shared/process-runner.ts";

export type CheckName = "vault" | "engine" | "github" | "telegram";

export interface CheckResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface CheckInputs {
  readonly vaultPath: string | null;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly claudeExecutable: string | null;
  readonly telegramToken: string | null;
  /** The Bot API address; a test points it at a fake server. */
  readonly telegramBaseUrl?: string;
}

const checkTimeoutMs = 30_000;

export async function runCheck(name: CheckName, inputs: CheckInputs): Promise<CheckResult> {
  if (name === "telegram") return checkTelegram(inputs);
  if (name === "github") return runProgram(["gh", "auth", "status"], process.cwd(), inputs, "gh is logged in.");
  if (name === "engine") {
    if (inputs.claudeExecutable === null) return { ok: false, detail: "No claude program was found." };
    return runProgram([inputs.claudeExecutable, "--version"], process.cwd(), inputs, null);
  }
  if (inputs.vaultPath === null) return { ok: false, detail: "No vault is configured." };
  return runProgram(
    ["git", "ls-remote", "--heads", "origin"],
    inputs.vaultPath,
    inputs,
    "The vault's remote answered.",
  );
}

async function runProgram(
  command: readonly string[],
  cwd: string,
  inputs: CheckInputs,
  okDetail: string | null,
): Promise<CheckResult> {
  try {
    const result = await inputs.runner.run(command, {
      cwd,
      environment: { ...inputs.environment, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: checkTimeoutMs,
    });
    const output = (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/)[0] ?? "";
    return result.exitCode === 0
      ? { ok: true, detail: okDetail ?? output }
      : { ok: false, detail: result.stderr.trim().split(/\r?\n/)[0] ?? "failed" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "failed" };
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
