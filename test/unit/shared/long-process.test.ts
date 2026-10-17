import { describe, expect, test } from "bun:test";
import { systemLongProcessStarter } from "../../../src/shared/long-process.ts";

const bun = process.execPath;
const environment = { PATH: process.env["PATH"] ?? "", SYSTEMROOT: process.env["SYSTEMROOT"] ?? "" };

describe("systemLongProcessStarter", () => {
  test("reports the exit code when the process ends by itself", async () => {
    const child = systemLongProcessStarter([bun, "-e", "process.exit(3)"], { cwd: process.cwd(), environment });
    expect(await child.exited).toBe(3);
  });

  test("gives the child only the environment it was given", async () => {
    const child = systemLongProcessStarter(
      [
        bun,
        "-e",
        "process.exit(process.env.EVA_PROBE === 'yes' && process.env.EVA_SECRET_PROBE === undefined ? 0 : 1)",
      ],
      { cwd: process.cwd(), environment: { ...environment, EVA_PROBE: "yes" } },
    );
    expect(await child.exited).toBe(0);
  });

  test("a stop ends a process that runs on, within its timeout", async () => {
    const child = systemLongProcessStarter([bun, "-e", "setTimeout(() => {}, 60_000)"], {
      cwd: process.cwd(),
      environment,
    });
    const started = Date.now();
    await child.stop(1_000);
    await child.exited;
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("a stop ends a process that ignores the gentle stop", async () => {
    const child = systemLongProcessStarter(
      [bun, "-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60_000)"],
      { cwd: process.cwd(), environment },
    );
    // Gives the child time to set its handler, so the gentle stop really is ignored.
    await Bun.sleep(300);
    await child.stop(300);
    await child.exited;
  });

  test("a stop after the process ended returns at once", async () => {
    const child = systemLongProcessStarter([bun, "-e", "process.exit(0)"], { cwd: process.cwd(), environment });
    await child.exited;
    await child.stop(60_000);
  });
});
