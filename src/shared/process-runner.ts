/**
 * The process seam. Every child process Eva starts (git, gh, pskill) goes through a
 * ProcessRunner, so tests can fake it and every run has a timeout (lessons 24, 81).
 */
import { EvaError } from "./errors.ts";

export interface ProcessRunOptions {
  readonly cwd: string;
  /** The whole environment of the child. Build it with buildChildEnvironment (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly stdin?: string;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  /** Runs a command to its end. Throws EvaError `process_timeout` or `process_failed`. */
  run(command: readonly string[], options: ProcessRunOptions): Promise<ProcessResult>;
}

/** The longest reason, so that a message stays readable on a phone. */
const maxReasonLength = 500;

/**
 * Why a command failed: its error output, or else its exit code and its normal output.
 * Never empty: git can fail with no error output, and an empty message tells the person nothing (#430).
 */
export function failureReason(result: ProcessResult, program: string): string {
  const errorOutput = result.stderr.trim();
  if (errorOutput !== "") return errorOutput.slice(0, maxReasonLength);
  const output = result.stdout.trim();
  const reason = `${program} ended with exit code ${String(result.exitCode)} and wrote no error.`;
  return (output === "" ? reason : `${reason} Its output: ${output}`).slice(0, maxReasonLength);
}

/** After a gentle stop, the time a process gets before the hard stop. */
const gracePeriodMs = 2_000;

export const systemProcessRunner: ProcessRunner = {
  async run(command, options) {
    let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      child = Bun.spawn([...command], {
        cwd: options.cwd,
        env: { ...options.environment },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        detached: process.platform !== "win32",
      });
    } catch (error) {
      throw new EvaError("process_failed", `Could not start ${command[0] ?? "a process"}.`, { cause: error });
    }

    if (options.stdin !== undefined) await child.stdin.write(options.stdin);
    await child.stdin.end();

    const timeout = { reached: false };
    const timer = setTimeout(() => {
      timeout.reached = true;
      stopProcessTree(child.pid);
    }, options.timeoutMs);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (timeout.reached) {
        throw new EvaError("process_timeout", `${command[0] ?? "A process"} ran past ${options.timeoutMs} ms.`);
      }
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  },
};

export type StopStep =
  | { readonly kind: "command"; readonly command: readonly string[] }
  | { readonly kind: "signal-group"; readonly signal: NodeJS.Signals; readonly afterMs: number };

/**
 * How to stop a process and its children: gently first, then hard (lesson 81). git leaves
 * `index.lock` behind after a hard stop, so the gentle stop comes first. Windows has no
 * process groups, so `taskkill /T` stops the tree there.
 */
export function stopSteps(platform: NodeJS.Platform, pid: number): StopStep[] {
  if (platform === "win32") return [{ kind: "command", command: ["taskkill", "/T", "/F", "/PID", String(pid)] }];
  return [
    { kind: "signal-group", signal: "SIGTERM", afterMs: 0 },
    { kind: "signal-group", signal: "SIGKILL", afterMs: gracePeriodMs },
  ];
}

/** Stops a process and its children: a gentle stop, then a hard one (lesson 81). */
export function stopProcessTree(pid: number): void {
  for (const step of stopSteps(process.platform, pid)) {
    if (step.kind === "command") {
      Bun.spawn([...step.command], { stdout: "ignore", stderr: "ignore" });
    } else {
      setTimeout(() => {
        signalGroup(pid, step.signal);
      }, step.afterMs).unref();
    }
  }
}

/** Sends a signal to a process group. Returns false when the group already ended. */
export function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}
