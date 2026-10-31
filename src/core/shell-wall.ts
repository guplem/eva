/**
 * Whether Claude Code's sandbox can wall the shell of a Project chat on this computer (#711). The
 * sandbox reports nothing to Eva when it cannot start, so Eva looks for what it needs. The file
 * tools of each chat stay walled either way: only the shell can then read the vault.
 */
import { failureReason, type ProcessRunner } from "../shared/process-runner.ts";

export interface ShellWallMachine {
  readonly platform: NodeJS.Platform;
  readonly which: (program: string) => string | null;
  readonly runner: ProcessRunner;
  /** The environment of the trial run. */
  readonly environment: Readonly<Record<string, string>>;
}

/** A trial run is quick. A machine that hangs on it has no sandbox that works. */
const trialTimeoutMs = 10_000;

/** Null when the sandbox can run here, else why not, in words for the person. */
export async function shellWallGap(machine: ShellWallMachine): Promise<string | null> {
  if (machine.platform === "darwin") return null;
  if (machine.platform === "win32") return "Claude Code has no shell sandbox that Eva can turn on for you on Windows.";
  if (machine.platform !== "linux") return `Claude Code has no shell sandbox on ${machine.platform}.`;
  const missing = [
    ...(machine.which("bwrap") === null ? ["bubblewrap"] : []),
    ...(machine.which("socat") === null ? ["socat"] : []),
  ];
  if (missing.length > 0)
    return `Claude Code's shell sandbox needs ${missing.join(" and ")}. Install them, such as with \`sudo apt install bubblewrap socat\`, then restart Eva.`;
  // An installed bubblewrap can still fail, such as where the system allows no user namespace.
  const trial = ["bwrap", "--ro-bind", "/", "/", "--unshare-user", "--unshare-net", "true"];
  const cannot = (reason: string): string => `Claude Code's shell sandbox cannot start on this computer: ${reason}`;
  try {
    const result = await machine.runner.run(trial, {
      cwd: "/",
      environment: machine.environment,
      timeoutMs: trialTimeoutMs,
    });
    return result.exitCode === 0 ? null : cannot(failureReason(result, "bwrap"));
  } catch (error) {
    return cannot(error instanceof Error ? error.message : String(error));
  }
}
