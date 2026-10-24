/** The Windows tray script for tests: it records each view, and writes the menu choices of the test. */
import type { LineProcessStarter } from "../../src/shared/line-process.ts";

export interface FakeTray {
  readonly start: LineProcessStarter;
  /** The command that started the script. */
  readonly command: string[];
  /** Each line that the script got. */
  readonly sent: string[];
  /** The face of each view that the script got. */
  faces(): string[];
  /** Writes a line as the script does after a menu choice. */
  choose(line: string): void;
  /** Ends the script by itself, with this error output. */
  end(stderr?: string): void;
  closed(): boolean;
}

export function fakeTray(): FakeTray {
  const command: string[] = [];
  const sent: string[] = [];
  const queue: string[] = [];
  let wake: () => void = () => undefined;
  let ended = false;
  let closed = false;
  let stderr = "";
  const exited = Promise.withResolvers<number>();
  const lines = async function* (): AsyncIterable<string> {
    for (;;) {
      const line = queue.shift();
      if (line !== undefined) {
        yield line;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };
  const finish = (): void => {
    ended = true;
    wake();
    exited.resolve(0);
  };
  return {
    start: (started) => {
      command.push(...started);
      return {
        send: (line) => sent.push(line),
        lines: lines(),
        exited: exited.promise,
        close: () => {
          closed = true;
          finish();
          return Promise.resolve();
        },
        stderrTail: () => stderr,
      };
    },
    command,
    sent,
    faces: () => sent.map((line) => (JSON.parse(line) as { face: string }).face),
    choose: (line) => {
      queue.push(line);
      wake();
    },
    end: (text = "") => {
      stderr = text;
      finish();
    },
    closed: () => closed,
  };
}
