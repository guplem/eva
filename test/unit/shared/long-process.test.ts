import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEvaError } from "../../../src/shared/errors.ts";
import { systemLongProcessStarter } from "../../../src/shared/long-process.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };
const windows = process.platform === "win32";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-long-process-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

async function waitForFile(path: string): Promise<void> {
  const started = Date.now();
  while (!existsSync(path) && Date.now() - started < 20_000) await Bun.sleep(20);
}

describe("systemLongProcessStarter", () => {
  test("reports the exit code when the process ends by itself", async () => {
    const child = systemLongProcessStarter([bun, "-e", "process.exit(3)"], { cwd: process.cwd(), environment });
    expect(await child.exited).toBe(3);
  });

  test("gives the child only the environment it was given", async () => {
    process.env["EVA_SECRET_PROBE"] = "leak";
    try {
      const child = systemLongProcessStarter(
        [
          bun,
          "-e",
          "process.exit(process.env.EVA_PROBE === 'yes' && process.env.EVA_SECRET_PROBE === undefined ? 0 : 1)",
        ],
        { cwd: process.cwd(), environment: { ...environment, EVA_PROBE: "yes" } },
      );
      expect(await child.exited).toBe(0);
    } finally {
      delete process.env["EVA_SECRET_PROBE"];
    }
  });

  test("a program that does not exist fails with process_failed", () => {
    let caught: unknown = null;
    try {
      systemLongProcessStarter([join(folder, "no-such-program")], { cwd: process.cwd(), environment });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "process_failed")).toBe(true);
  });

  test("a stop ends a process that runs on, gently where the system allows it", async () => {
    const child = systemLongProcessStarter([bun, "-e", "setTimeout(() => {}, 60_000)"], {
      cwd: process.cwd(),
      environment,
    });
    await child.stop(1_000);
    const exitCode = await child.exited;
    // 143 is 128 plus SIGTERM. Windows has no gentle stop for another process.
    if (!windows) expect(exitCode).toBe(143);
  });

  test("a stop ends a process that ignores the gentle stop, after the timeout", async () => {
    const ready = join(folder, "ready");
    // The path goes through the environment: a script with quotes and backslashes can break on Windows.
    const child = systemLongProcessStarter(
      [
        bun,
        "-e",
        "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.env.EVA_READY, ''); setTimeout(() => {}, 60_000)",
      ],
      { cwd: process.cwd(), environment: { ...environment, EVA_READY: ready } },
    );
    await waitForFile(ready);
    expect(existsSync(ready)).toBe(true);
    const started = Date.now();
    await child.stop(300);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    const exitCode = await child.exited;
    // 137 is 128 plus SIGKILL.
    if (!windows) expect(exitCode).toBe(137);
  });

  test("a stop after the process ended returns at once", async () => {
    const child = systemLongProcessStarter([bun, "-e", "process.exit(0)"], { cwd: process.cwd(), environment });
    await child.exited;
    const started = Date.now();
    await child.stop(60_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
