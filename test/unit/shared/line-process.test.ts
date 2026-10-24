import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isEvaError } from "../../../src/shared/errors.ts";
import { systemLineProcessStarter } from "../../../src/shared/line-process.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };

// Answers each input line with the line in capitals, and ends when its input ends.
const echo = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    process.stdout.write(buffer.slice(0, newline).toUpperCase() + "\\r\\n");
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
  }
});
process.stdin.on("end", () => process.exit(5));
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
  test("sends lines to the child, reads its lines with no line ends, and a close ends its input", async () => {
    const child = systemLineProcessStarter([bun, "-e", echo], { cwd: process.cwd(), environment });
    child.send("open");
    child.send("quit");
    expect(await firstLines(child.lines, 2)).toEqual(["OPEN", "QUIT"]);
    await child.close(5_000);
    expect(await child.exited).toBe(5);
  });

  test("the lines end when the child exits, with a last line that has no line end", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.stdout.write('a\\n\\nb')"], {
      cwd: process.cwd(),
      environment,
    });
    const lines: string[] = [];
    for await (const line of child.lines) lines.push(line);
    expect(lines).toEqual(["a", "b"]);
    expect(await child.exited).toBe(0);
  });

  test("a close stops a child that does not end by itself, after the timeout", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.stdin.resume(); setTimeout(() => {}, 60_000)"], {
      cwd: process.cwd(),
      environment,
    });
    const started = Date.now();
    await child.close(300);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    await child.exited;
  });

  test("the error output is complete once the exit settles", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.stderr.write('broken'); process.exit(2)"], {
      cwd: process.cwd(),
      environment,
    });
    expect(await child.exited).toBe(2);
    expect(child.stderrTail()).toBe("broken");
  });

  test("a send after the child ended does nothing", async () => {
    const child = systemLineProcessStarter([bun, "-e", "process.exit(0)"], { cwd: process.cwd(), environment });
    await child.exited;
    child.send("late");
    await child.close(1_000);
  });

  test("a program that does not exist fails with process_failed", () => {
    let caught: unknown = null;
    try {
      systemLineProcessStarter([join(process.cwd(), "no-such-program")], { cwd: process.cwd(), environment });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "process_failed")).toBe(true);
  });
});
