/**
 * The seam for a long child that shows Eva's newest line and answers with lines on its output,
 * such as the Windows tray icon. A ProcessRunner run has a timeout and reads the output only at
 * the end, and a LongProcess has no pipes. Like a LongProcess, it has no run timeout: every
 * close is bounded instead (lesson 81).
 *
 * The newest line waits in a file, not in the child's input: Windows PowerShell, a .NET
 * Framework program, never reads a line from the input pipe that Bun gives it (#457).
 */
import { rmSync } from "node:fs";
import { writeFileAtomic } from "./files.ts";
import { EvaError } from "./errors.ts";
import { stopProcessTree } from "./process-runner.ts";

/** The child reads the newest line from the file that this variable names. */
const lineFileVariable = "EVA_LINE_FILE";
/** Eva's pid: the child ends when this process is gone, also after a hard stop of Eva. */
const lineParentVariable = "EVA_LINE_PARENT";

export interface LineProcess {
  /** Replaces the line that the child reads. False when the write failed: publish it again later. */
  publish(line: string): boolean;
  /** Each output line, with no line end and with no empty line. Ends when the child exits. */
  readonly lines: AsyncIterable<string>;
  readonly exited: Promise<number>;
  /** Removes the line file, which asks the child to stop, and stops it hard after the timeout. */
  close(timeoutMs: number): Promise<void>;
  /** The last part of the error output, for a log line. It is complete once `exited` settles. */
  stderrTail(): string;
}

export interface LineProcessOptions {
  readonly cwd: string;
  /** The whole environment of the child. Build it with buildChildEnvironment (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
  /** Where the newest line waits for the child. Only one child may use it. */
  readonly lineFile: string;
}

export type LineProcessStarter = (command: readonly string[], options: LineProcessOptions) => LineProcess;

const stderrLimit = 2_000;
const stderrWaitMs = 1_000;

export const systemLineProcessStarter: LineProcessStarter = (command, options) => {
  // A file from a child before a hard stop would show an old line to the new child.
  removeLineFile(options.lineFile);
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn([...command], {
      cwd: options.cwd,
      env: {
        ...options.environment,
        [lineFileVariable]: options.lineFile,
        [lineParentVariable]: String(process.pid),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      // Its own process group, so a hard stop reaches its children too (lesson 81).
      detached: process.platform !== "win32",
    });
  } catch (error) {
    throw new EvaError("process_failed", `Could not start ${command[0] ?? "a process"}.`, { cause: error });
  }
  let stderr = "";
  const stderrRead = (async () => {
    for await (const text of child.stderr.pipeThrough(new TextDecoderStream())) {
      stderr = (stderr + text).slice(-stderrLimit);
    }
  })().catch(() => undefined);
  // The exit can come before the last error output: a reader of stderrTail waits for both. A child
  // of the child can keep the error output open, so that wait has a bound.
  const exited = child.exited.then(async (code) => {
    await Promise.race([stderrRead, Bun.sleep(stderrWaitMs)]);
    return code;
  });
  let closed = false;
  return {
    publish: (line) => {
      if (closed) return true;
      try {
        writeFileAtomic(options.lineFile, `${line}\n`);
        return true;
      } catch {
        // On Windows, a rename fails while the child reads the file.
        return false;
      }
    },
    lines: readLines(child.stdout),
    exited,
    close: async (timeoutMs) => {
      closed = true;
      removeLineFile(options.lineFile);
      const ended = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
      if (ended) return;
      stopProcessTree(child.pid);
      // A hard stop can fail too, so even this wait has a bound.
      await Promise.race([child.exited, Bun.sleep(timeoutMs)]);
    },
    stderrTail: () => stderr,
  };
};

/** A file that cannot go, such as one in a folder that is gone, never stops a start or a close. */
function removeLineFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Nothing to remove.
  }
}

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
