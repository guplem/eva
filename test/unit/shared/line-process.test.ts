import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEvaError } from "../../../src/shared/errors.ts";
import { systemLineProcessStarter } from "../../../src/shared/line-process.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };

let folder: string;
let lineFile: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-line-process-"));
  lineFile = join(folder, "line.json");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

// Answers each new line in the file with the line in capitals, and ends when the file stays away.
// As the tray script does, it waits out a moment with no file, or a refused read, during a write.
const echo = `
const { readFileSync } = require("node:fs");
let last = "";
let seen = false;
let missing = 0;
setInterval(() => {
  let line;
  try {
    line = readFileSync(process.env.EVA_LINE_FILE, "utf-8").trim();
  } catch {
    missing += 1;
    if (seen && missing >= 20) process.exit(5);
    return;
  }
  seen = true;
  missing = 0;
  if (line !== last) {
    last = line;
    process.stdout.write(line.toUpperCase() + "\\r\\n");
  }
}, 10);
`;

async function firstLines(lines: AsyncIterable<string>, count: number): Promise<string[]> {
  const read: string[] = [];
  for await (const line of lines) {
    read.push(line);
    if (read.length === count) break;
  }
  return read;
}

describe("systemLineProcessStarter", () => {
  test("the child reads each newest line from the file, and a close removes it, so the child ends", async () => {
    const child = systemLineProcessStarter([bun, "-e", echo], { cwd: folder, environment, lineFile });
    // A write fails while the child reads the file: it goes again.
    const publish = async (line: string): Promise<void> => {
      while (!child.publish(line)) await Bun.sleep(10);
    };
    await publish("open");
    const lines = child.lines[Symbol.asyncIterator]();
    expect((await lines.next()).value).toBe("OPEN");
    await publish("quit");
    expect((await lines.next()).value).toBe("QUIT");
    await child.close(5_000);
    expect(existsSync(lineFile)).toBe(false);
    expect(await child.exited).toBe(5);
  });

  test("a new child never sees the file of an old one, and gets the parent's pid", async () => {
    writeFileSync(lineFile, "old\n");
    const child = systemLineProcessStarter(
      [bun, "-e", "console.log(require('node:fs').existsSync(process.env.EVA_LINE_FILE), process.env.EVA_LINE_PARENT)"],
      { cwd: folder, environment, lineFile },
    );
    expect(await firstLines(child.lines, 1)).toEqual([`false ${String(process.pid)}`]);
    await child.close(1_000);
  });

  test("the lines end when the child exits, with a last line that has no line end", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.stdout.write('a\\n\\nb')"], {
      cwd: folder,
      environment,
      lineFile,
    });
    const lines: string[] = [];
    for await (const line of child.lines) lines.push(line);
    expect(lines).toEqual(["a", "b"]);
    expect(await child.exited).toBe(0);
  });

  test("a close stops a child that does not end by itself, after the timeout", async () => {
    const child = systemLineProcessStarter([bun, "-e", "setTimeout(() => {}, 60_000)"], {
      cwd: folder,
      environment,
      lineFile,
    });
    const started = Date.now();
    await child.close(300);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    await child.exited;
  });

  test("the error output is complete once the exit settles", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.stderr.write('broken'); process.exit(2)"], {
      cwd: folder,
      environment,
      lineFile,
    });
    expect(await child.exited).toBe(2);
    expect(child.stderrTail()).toBe("broken");
  });

  test("a publish after the close writes nothing, and a failed write says so", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.exit(0)"], { cwd: folder, environment, lineFile });
    await child.exited;
    await child.close(1_000);
    expect(child.publish("late")).toBe(true);
    expect(existsSync(lineFile)).toBe(false);
    const blocked = systemLineProcessStarter([bun, "-e", "process.exit(0)"], {
      cwd: folder,
      environment,
      // A file inside a file cannot be written.
      lineFile: join(lineFile, "inside"),
    });
    writeFileSync(lineFile, "a file, not a folder");
    expect(blocked.publish("view")).toBe(false);
    await blocked.close(1_000);
  });

  test("a program that does not exist fails with process_failed", () => {
    let caught: unknown = null;
    try {
      systemLineProcessStarter([join(folder, "no-such-program")], { cwd: folder, environment, lineFile });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "process_failed")).toBe(true);
  });
});
