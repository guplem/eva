/**
 * The pi child process seam: `pi --mode rpc` speaks JSON records, one per line, on stdin and
 * stdout. Tests replace the starter with a fake that replays captured records.
 */
import { stopProcessTree } from "../../shared/process-runner.ts";

export interface PiProcess {
  send(record: Readonly<Record<string, unknown>>): void;
  /** Every stdout record, in order. Ends when pi exits. */
  readonly records: AsyncIterable<Record<string, unknown>>;
  /** Closes stdin, which asks pi to stop, and stops it hard after the timeout. */
  close(timeoutMs: number): Promise<void>;
  /** The last part of stderr, for an error message. */
  stderrTail(): string;
}

export interface PiProcessOptions {
  readonly cwd: string;
  /** The whole environment of pi (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
}

export type PiProcessStarter = (command: readonly string[], options: PiProcessOptions) => PiProcess;

const stderrLimit = 4_000;

export const systemPiProcessStarter: PiProcessStarter = (command, options) => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: { ...options.environment },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // Its own process group, so a stop reaches pi's shell and git children too (lesson 81).
    detached: process.platform !== "win32",
  });
  let stderr = "";
  void (async () => {
    for await (const text of child.stderr.pipeThrough(new TextDecoderStream())) {
      stderr = (stderr + text).slice(-stderrLimit);
    }
  })();
  return {
    send: (record) => {
      void child.stdin.write(`${JSON.stringify(record)}\n`);
      void child.stdin.flush();
    },
    records: readJsonLines(child.stdout),
    close: async (timeoutMs) => {
      // Not awaited: the end waits for pi to read what is left in the pipe, and a stuck pi never does.
      void Promise.resolve()
        .then(() => child.stdin.end())
        .catch(() => undefined);
      const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
      if (!exited) stopProcessTree(child.pid);
    },
    stderrTail: () => stderr,
  };
};

/**
 * Splits a byte stream into JSON records on LF only, with no line length limit: one pi
 * record can be hundreds of kilobytes (lesson 52), and a JSON string may hold U+2028, which
 * a generic line reader treats as a line break. A line that is not JSON is skipped.
 */
export async function* readJsonLines(stream: ReadableStream<Uint8Array>): AsyncIterable<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    // `stream: true` keeps a character that a chunk boundary splits.
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const record = parseRecord(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (record !== null) yield record;
      newline = buffer.indexOf("\n");
    }
  }
  const last = parseRecord(buffer);
  if (last !== null) yield last;
}

function parseRecord(line: string): Record<string, unknown> | null {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (trimmed.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
