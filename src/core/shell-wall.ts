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
  /** True when Eva runs as root, where Claude Code keeps one right in its box. */
  readonly root: boolean;
}

/** A trial run is quick. A machine that hangs on it has no sandbox that works. */
const trialTimeoutMs = 10_000;

/** Why the shell of a Project chat has no wall here, in words for the person. */
export interface ShellWallGap {
  readonly reason: string;
  /** False where no step of the person gives the shell a wall, such as on Windows (#825). */
  readonly fixable: boolean;
}

/** Null when the sandbox can run here, else why not. */
export async function shellWallGap(machine: ShellWallMachine): Promise<ShellWallGap | null> {
  if (machine.platform === "darwin") return null;
  if (machine.platform === "win32")
    return { reason: "Claude Code has no shell sandbox that Eva can turn on for you on Windows.", fixable: false };
  if (machine.platform !== "linux")
    return { reason: `Claude Code has no shell sandbox on ${machine.platform}.`, fixable: false };
  const reason = await linuxGap(machine);
  return reason === null ? null : { reason, fixable: true };
}

/** Null when bubblewrap can run here, else why not. */
async function linuxGap(machine: ShellWallMachine): Promise<string | null> {
  const missing = [
    ...(machine.which("bwrap") === null ? ["bubblewrap"] : []),
    ...(machine.which("socat") === null ? ["socat"] : []),
  ];
  if (missing.length > 0)
    return `Claude Code's shell sandbox needs ${missing.join(" and ")}. Run the install command of Eva again, or install them, such as with \`sudo apt-get update && sudo apt-get install bubblewrap socat\`. Then restart Eva.`;
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

/**
 * True when a sandbox can start inside the sandbox, as Claude Code's Unix socket filter does on
 * Linux (#760). A recent Ubuntu lets bubblewrap make one user namespace but not a second inside
 * it. There, the filter breaks every shell command, so Eva turns it off. macOS makes no namespace.
 */
export async function nestedSandboxWorks(machine: ShellWallMachine): Promise<boolean> {
  if (machine.platform === "darwin") return true;
  if (machine.platform !== "linux" || machine.which("bwrap") === null) return false;
  // Claude Code drops every right in its box. As root, it keeps the one that a nested namespace
  // needs, and only when the system grants it. The trial does the same, so it sees what they see.
  const trial = [
    ...["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc"],
    ...["--unshare-user", "--unshare-net", "--cap-drop", "ALL", ...(machine.root ? ["--cap-add", "CAP_SETFCAP"] : [])],
    ...["unshare", "--user", "--map-root-user", "--pid", "--mount", "--fork", "true"],
  ];
  try {
    const result = await machine.runner.run(trial, {
      cwd: "/",
      environment: machine.environment,
      timeoutMs: trialTimeoutMs,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
