/**
 * The terminal seam. A few programs, such as `claude setup-token`, print nothing unless they
 * run in a terminal. This seam starts such a program in a pseudo-terminal (a fake terminal that
 * Eva drives), so Eva can read its output and type into it. Tests replace the starter with a fake.
 */
import { EvaError } from "./errors.ts";
import { stopProcessTree } from "./process-runner.ts";

export interface TerminalProcessOptions {
  readonly cwd: string;
  /** The whole environment of the child. Build it with buildChildEnvironment (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
  /** After this time, the seam stops the program, whatever it does. */
  readonly timeoutMs: number;
}

export interface TerminalProcess {
  /** All the output so far, as text, with the terminal codes still in it. */
  output(): string;
  /** Calls `listener` after each new piece of output. */
  onOutput(listener: () => void): void;
  /** Types text into the terminal. A `\r` is the Enter key. */
  write(text: string): void;
  /** The exit code. */
  readonly exited: Promise<number>;
  /** Stops the program and its children. */
  stop(): void;
}

export type TerminalProcessStarter = (command: readonly string[], options: TerminalProcessOptions) => TerminalProcess;

/** Wide, so that a long address stays on one line. */
const terminalSize = { cols: 500, rows: 50 };
/** A program that prints much more than a login is broken; Eva keeps only the last part. */
const outputLimit = 200_000;

/** Throws EvaError `process_failed` when the program cannot start. */
export const systemTerminalProcessStarter: TerminalProcessStarter = (command, options) => {
  const decoder = new TextDecoder();
  const listeners: (() => void)[] = [];
  let output = "";
  let child: Bun.Subprocess;
  try {
    child = Bun.spawn([...command], {
      cwd: options.cwd,
      env: { ...options.environment },
      terminal: {
        ...terminalSize,
        data: (_terminal, bytes) => {
          // `stream: true` keeps a character that a chunk boundary splits.
          output = (output + decoder.decode(bytes, { stream: true })).slice(-outputLimit);
          for (const listener of listeners) listener();
        },
      },
    });
  } catch (error) {
    throw new EvaError("process_failed", `Could not start ${command[0] ?? "a process"}.`, { cause: error });
  }
  const stop = (): void => {
    if (child.exitCode === null && child.signalCode === null) stopProcessTree(child.pid);
  };
  const timer = setTimeout(stop, options.timeoutMs);
  const exited = child.exited.then((code) => {
    clearTimeout(timer);
    child.terminal?.close();
    return code;
  });
  return {
    output: () => output,
    onOutput: (listener) => {
      listeners.push(listener);
    },
    write: (text) => {
      child.terminal?.write(text);
    },
    exited,
    stop,
  };
};
