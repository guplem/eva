/**
 * The Test buttons of the settings page: one real, small check for each
 * part Eva depends on. A check never shows a secret, even in its error text.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineName, EnginePort } from "../shared/engine-port.ts";
import type { ProcessRunner } from "../shared/process-runner.ts";

export type CheckName = "vault" | EngineName | "github" | "telegram";

export const checkNames: readonly CheckName[] = ["vault", "claude-code", "pi", "github", "telegram"];

export interface CheckResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface CheckInputs {
  readonly vaultPath: string | null;
  readonly runner: ProcessRunner;
  /** The environment of the git and gh checks. */
  readonly environment: Readonly<Record<string, string>>;
  /** The engines that Eva found on this machine. */
  readonly engines: readonly EnginePort[];
  /** The environment of a real turn, with the engine's login (lesson 96). */
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
const engineLabels: Readonly<Record<EngineName, string>> = { "claude-code": "Claude Code", pi: "pi" };
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
    inputs,
    "Eva can push to the vault's remote.",
  );
}

/**
 * One real turn proves the program, the login and the model at once; `--version` proves only the
 * program. Project mode in an empty, untrusted folder adds no prompt, skill, hook or MCP server.
 */
async function checkEngine(name: EngineName, inputs: CheckInputs): Promise<CheckResult> {
  const engine = inputs.engines.find((candidate) => candidate.name === name);
  if (engine === undefined) return { ok: false, detail: `Eva did not find ${engineLabels[name]} on this machine.` };
  const folder = mkdtempSync(join(tmpdir(), "eva-engine-check-"));
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, inputs.engineTimeoutMs ?? engineCheckTimeoutMs);
  try {
    let reply = "";
    for await (const event of engine.runTurn({
      mode: "project",
      history: { kind: "new", engineSessionId: randomUUID() },
      startFolder: folder,
      prompt: enginePrompt,
      model: "default",
      appendSystemPrompt: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: false,
      environment: inputs.engineEnvironment,
      requestApproval: () => Promise.resolve("deny"),
      signal: controller.signal,
    })) {
      if (event.kind === "text") reply += event.text;
      if (controller.signal.aborted) return { ok: false, detail: `${engineLabels[name]} gave no answer in time.` };
      if (event.kind === "turn_failed") return { ok: false, detail: inputs.redact(event.reason) };
      if (event.kind === "turn_finished") {
        const preview = (reply.trim().split(/\r?\n/)[0] ?? "").slice(0, replyPreviewLength);
        return { ok: true, detail: inputs.redact(`${engineLabels[name]} answered: ${preview}`) };
      }
    }
    return { ok: false, detail: `${engineLabels[name]} stopped without an answer.` };
  } catch (error) {
    return { ok: false, detail: inputs.redact(error instanceof Error ? error.message : "failed") };
  } finally {
    clearTimeout(timer);
    rmSync(folder, { recursive: true, force: true });
  }
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

/** Eva's git commands use the saved token, not gh's login, so the token itself is what to check. */
async function checkGithub(inputs: CheckInputs): Promise<CheckResult> {
  if (inputs.githubToken === null)
    return runProgram(["gh", "auth", "status"], process.cwd(), inputs, "gh is logged in.");
  try {
    const response = await fetch(`${inputs.githubBaseUrl ?? "https://api.github.com"}/user`, {
      headers: { authorization: `Bearer ${inputs.githubToken}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(checkTimeoutMs),
    });
    if (!response.ok) return { ok: false, detail: "GitHub refused the token." };
    const body = (await response.json()) as { login?: string };
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
