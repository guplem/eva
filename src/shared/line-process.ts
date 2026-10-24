/**
 * The seam for a long child that speaks text lines on its input and output, such as the
 * Windows tray icon. A ProcessRunner run has a timeout and reads the output only at the end,
 * and a LongProcess has no pipes. Like a LongProcess, it has no run timeout: every close is
 * bounded instead (lesson 81).
 */
import { EvaError } from "./errors.ts";
import { stopProcessTree } from "./process-runner.ts";

export interface LineProcess {
  /** Writes one line to the child's input. Does nothing after the child ended. */
  send(line: string): void;
  /** Each output line, with no line end and with no empty line. Ends when the child exits. */
  readonly lines: AsyncIterable<string>;
  readonly exited: Promise<number>;
  /** Ends the child's input, which asks it to stop, and stops it hard after the timeout. */
  close(timeoutMs: number): Promise<void>;
  /** The last part of the error output, for a log line. */
  stderrTail(): string;
}

export interface LineProcessOptions {
  readonly cwd: string;
  /** The whole environment of the child. Build it with buildChildEnvironment (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
}

export type LineProcessStarter = (command: readonly string[], options: LineProcessOptions) => LineProcess;

const stderrLimit = 2_000;

export const systemLineProcessStarter: LineProcessStarter = (command, options) => {
  let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    child = Bun.spawn([...command], {
      cwd: options.cwd,
      env: { ...options.environment },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      // Its own process group, so a hard stop reaches its children too (lesson 81).
      detached: process.platform !== "win32",
    });
  } catch (error) {
    throw new EvaError("process_failed", `Could not start ${command[0] ?? "a process"}.`, { cause: error });
  }
  let stderr = "";
  void (async () => {
    for await (const text of child.stderr.pipeThrough(new TextDecoderStream())) {
      stderr = (stderr + text).slice(-stderrLimit);
    }
  })().catch(() => undefined);
  let inputOpen = true;
  const endInput = async (): Promise<void> => {
    if (!inputOpen) return;
    inputOpen = false;
    try {
      await child.stdin.end();
    } catch {
      // The child already closed its input.
    }
  };
  void child.exited.then(() => {
    inputOpen = false;
  });
  return {
    send: (line) => {
      if (!inputOpen) return;
      try {
        void child.stdin.write(`${line}\n`);
        // A pipe that broke as the child ended can fail the flush: the child is gone, so it does not matter.
        void Promise.resolve(child.stdin.flush()).catch(() => undefined);
      } catch {
        // The child ended between the check and the write.
      }
    },
    lines: readLines(child.stdout),
    exited: child.exited,
    close: async (timeoutMs) => {
      await endInput();
      const ended = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
      if (ended) return;
      stopProcessTree(child.pid);
      // A hard stop can fail too, so even this wait has a bound.
      await Promise.race([child.exited, Bun.sleep(timeoutMs)]);
    },
    stderrTail: () => stderr,
  };
};

/** Splits a byte stream into lines on LF. Windows programs end a line with CRLF, so a CR goes too. */
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    // `stream: true` keeps a character that a chunk boundary splits.
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line !== "") yield line;
      newline = buffer.indexOf("\n");
    }
  }
  const last = buffer.replace(/\r$/, "");
  if (last !== "") yield last;
}
