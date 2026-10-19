import { describe, expect, test } from "bun:test";
import { isEvaError } from "../../../src/shared/errors.ts";
import { systemTerminalProcessStarter, type TerminalProcess } from "../../../src/shared/terminal-process.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };

/** Resolves when the output holds `text`. */
async function outputWith(child: TerminalProcess, text: string): Promise<string> {
  for (let tries = 0; tries < 200 && !child.output().includes(text); tries++) await Bun.sleep(25);
  return child.output();
}

describe("systemTerminalProcessStarter", () => {
  test("gives the program a terminal, and passes what Eva types", async () => {
    const script = [
      "process.stdout.write('tty=' + String(process.stdin.isTTY) + '\\n');",
      "process.stdin.on('data', (chunk) => { process.stdout.write('got=' + String(chunk).trim() + '\\n'); setTimeout(() => process.exit(4), 100); });",
    ].join(" ");
    const child = systemTerminalProcessStarter([bun, "-e", script], {
      cwd: process.cwd(),
      environment,
      timeoutMs: 20_000,
    });
    expect(await outputWith(child, "tty=")).toContain("tty=true");
    child.write("hello\r");
    expect(await outputWith(child, "got=")).toContain("got=hello");
    expect(await child.exited).toBe(4);
  });

  test("tells each listener about new output", async () => {
    const child = systemTerminalProcessStarter([bun, "-e", "setTimeout(() => console.log('late'), 200)"], {
      cwd: process.cwd(),
      environment,
      timeoutMs: 20_000,
    });
    const heard = new Promise<void>((resolve) => {
      child.onOutput(() => {
        if (child.output().includes("late")) resolve();
      });
    });
    await heard;
    await child.exited;
  });

  test("stops a program on request, and after its timeout", async () => {
    const stopped = systemTerminalProcessStarter([bun, "-e", "setTimeout(() => {}, 60_000)"], {
      cwd: process.cwd(),
      environment,
      timeoutMs: 20_000,
    });
    stopped.stop();
    const timedOut = systemTerminalProcessStarter([bun, "-e", "setTimeout(() => {}, 60_000)"], {
      cwd: process.cwd(),
      environment,
      timeoutMs: 300,
    });
    const started = Date.now();
    await Promise.all([stopped.exited, timedOut.exited]);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  test("reports a program that cannot start", () => {
    let error: unknown = null;
    try {
      systemTerminalProcessStarter(["eva-program-that-does-not-exist"], {
        cwd: process.cwd(),
        environment,
        timeoutMs: 5_000,
      });
    } catch (caught) {
      error = caught;
    }
    expect(isEvaError(error, "process_failed")).toBe(true);
  });
});
