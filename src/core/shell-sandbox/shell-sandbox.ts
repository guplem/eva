/**
 * `eva shell-sandbox <wall file> <command>`: the wrapper that runs each shell command of a pi
 * Project chat in the sandbox (#759). Eva's pi extension rewrites the model's command into a call
 * of this wrapper, and pi's bash tool runs it in the chat's folder.
 *
 * Each command gets its own sandbox: the library's network proxy lives exactly as long as the
 * command, in this process, and never in Eva's core, which holds every secret. The wall file
 * holds the library's config, which the pi engine writes for each turn.
 *
 * The wall fails closed. When the sandbox cannot start, the command does not run, and the model
 * reads why. Only Eva's start check may let a command run with no sandbox: then the extension
 * does not wrap it at all.
 */
import type { SandboxedCommandStarter } from "../../shared/sandboxed-command.ts";

/** What the model reads when the sandbox cannot start. It names no path: the chat must not know of a vault. */
export const sandboxFailedMessage =
  "Eva's shell sandbox could not start, so this command did not run. Nothing ran it outside the sandbox either.";

/** The exit code of a shell for a command that cannot run. */
const cannotRunExitCode = 126;

/** The sandbox library, behind a seam: a test replaces it with a fake. */
export interface SandboxLibrary {
  /** Checks the config and starts the network proxy. Rejects when the sandbox cannot start. */
  initialize(config: Readonly<Record<string, unknown>>): Promise<void>;
  /** The command line that runs `command` in the sandbox. */
  wrap(command: string): Promise<readonly string[]>;
  /** Removes what the sandbox left on disk for one command. */
  cleanup(): void;
  /** Stops the network proxy. */
  reset(): Promise<void>;
}

export interface ShellSandboxRun {
  readonly wallFile: string;
  /** The model's command, as it wrote it. */
  readonly command: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly library: SandboxLibrary;
  readonly start: SandboxedCommandStarter;
  readonly readText: (path: string) => string | null;
  readonly writeError: (text: string) => void;
}

/** Runs the command in the sandbox and gives its exit code. Never throws. */
export async function runShellSandbox(run: ShellSandboxRun): Promise<number> {
  const config = wallConfig(run.readText(run.wallFile));
  if (config === null) return failed(run);
  let command: readonly string[];
  try {
    await run.library.initialize(config);
    command = await run.library.wrap(run.command);
  } catch {
    await stop(run.library);
    return failed(run);
  }
  try {
    return await run.start(command, { cwd: run.cwd, environment: run.environment });
  } catch {
    return failed(run);
  } finally {
    await stop(run.library);
  }
}

function wallConfig(text: string | null): Readonly<Record<string, unknown>> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function failed(run: ShellSandboxRun): number {
  run.writeError(`${sandboxFailedMessage}\n`);
  return cannotRunExitCode;
}

/** A failed cleanup must not change the command's exit code: the command has run. */
async function stop(library: SandboxLibrary): Promise<void> {
  try {
    library.cleanup();
  } catch {
    // The library removes its mount points again at the next command.
  }
  await library.reset().catch(() => undefined);
}
