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

/**
 * Stops a process and its children: gently first, then hard (lesson 81). git leaves
 * `index.lock` behind after a hard stop, so the gentle stop comes first.
 */
function stopProcessTree(pid: number): void {
  if (process.platform === "win32") {
    Bun.spawn(["taskkill", "/T", "/F", "/PID", String(pid)], { stdout: "ignore", stderr: "ignore" });
    return;
  }
  signalGroup(pid, "SIGTERM");
  setTimeout(() => {
    signalGroup(pid, "SIGKILL");
  }, gracePeriodMs).unref();
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group already ended.
  }
}
