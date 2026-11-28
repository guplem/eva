/**
 * The seam of the shell sandbox wrapper, `eva shell-sandbox` (#759). It runs one command in the
 * sandbox and gives its exit code. The command shares the wrapper's input, output and error
 * output: pi reads the output while the command runs, so no buffer stands between them.
 *
 * It has no timeout. pi's bash tool stops the whole process group at its own timeout, and the
 * wrapper and this command with it. The environment is the wrapper's own, which pi got from
 * Eva through `buildChildEnvironment`.
 */
import { EvaError } from "./errors.ts";

export interface SandboxedCommandOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

export type SandboxedCommandStarter = (command: readonly string[], options: SandboxedCommandOptions) => Promise<number>;

export const systemSandboxedCommandStarter: SandboxedCommandStarter = async (command, options) => {
  let child: Bun.Subprocess<"inherit", "inherit", "inherit">;
  try {
    child = Bun.spawn([...command], {
      cwd: options.cwd,
      env: { ...options.environment },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (error) {
    throw new EvaError("process_failed", `Could not start ${command[0] ?? "a process"}.`, { cause: error });
  }
  return child.exited;
};
