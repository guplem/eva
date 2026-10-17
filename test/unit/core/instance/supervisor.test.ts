import { describe, expect, test } from "bun:test";
import {
  restartDecision,
  superviseEva,
  supervisedVariable,
  type Supervisor,
} from "../../../../src/core/instance/supervisor.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { LongProcessStarter } from "../../../../src/shared/long-process.ts";

describe("restartDecision", () => {
  test("a clean stop, bad settings and a second instance stop the supervisor with the same code", () => {
    for (const exitCode of [0, 2, 3]) expect(restartDecision(exitCode, 0)).toEqual({ kind: "stop", exitCode });
  });

  test("an update restarts at once, and it never counts as a crash", () => {
    expect(restartDecision(4, 0)).toEqual({ kind: "restart", afterMs: 0, crash: false });
    expect(restartDecision(4, 7)).toEqual({ kind: "restart", afterMs: 0, crash: false });
  });

  test("a crash restarts after a delay that doubles, and never waits more than 30 seconds", () => {
    const delays = [0, 1, 2, 3, 4, 50].map((crashes) => restartDecision(1, crashes));
    expect(delays.map((decision) => (decision.kind === "restart" ? decision.afterMs : null))).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
    expect(delays.every((decision) => decision.kind === "restart" && decision.crash)).toBe(true);
  });

  test("an unknown exit code, such as a hard kill, counts as a crash", () => {
    expect(restartDecision(137, 0)).toEqual({ kind: "restart", afterMs: 5_000, crash: true });
    expect(restartDecision(-1, 0)).toEqual({ kind: "restart", afterMs: 5_000, crash: true });
  });
});

interface FakeRun {
  /**
   * The exit code; "hold" for a child that runs until it is stopped; "stuck" for one that never
   * ends, even after a hard stop; "stop-fails" for one whose stop throws.
   */
  readonly exit: number | "hold" | "stuck" | "stop-fails" | "fail-to-start";
  /** How long the run lasts on the fake clock. */
  readonly lastsMs?: number;
}

interface Fake {
  readonly supervisor: Supervisor;
  readonly delays: number[];
  readonly environments: Readonly<Record<string, string>>[];
  readonly stopTimeouts: number[];
  readonly logs: string[];
  readonly starts: () => number;
}

function fakeSupervisor(runs: readonly FakeRun[]): Fake {
  let clock = 0;
  const delays: number[] = [];
  const environments: Readonly<Record<string, string>>[] = [];
  const stopTimeouts: number[] = [];
  const logs: string[] = [];
  let index = 0;
  let releaseHeld: ((code: number) => void) | null = null;
  const start: LongProcessStarter = (_command, options) => {
    environments.push(options.environment);
    const run = runs[index] ?? { exit: 0 };
    index += 1;
    if (run.exit === "fail-to-start") throw new EvaError("process_failed", "Could not start eva.");
    clock += run.lastsMs ?? 1_000;
    const exit = run.exit;
    const exited =
      typeof exit === "number"
        ? Promise.resolve(exit)
        : new Promise<number>((resolve) => {
            if (exit === "hold") releaseHeld = resolve;
          });
    return {
      exited,
      stop: (timeoutMs) => {
        stopTimeouts.push(timeoutMs);
        if (exit === "stop-fails") return Promise.reject(new Error("taskkill could not start"));
        releaseHeld?.(143);
        return Promise.resolve();
      },
    };
  };
  const pendingSleeps: (() => void)[] = [];
  const supervisor = superviseEva({
    command: ["eva", "--home", "/h"],
    cwd: "/h",
    environment: { PATH: "/bin" },
    start,
    now: () => clock,
    sleep: (ms) => {
      delays.push(ms);
      clock += ms;
      return runs.some((run) => run.exit === "hold" || run.exit === "stuck" || run.exit === "stop-fails") && ms > 0
        ? new Promise<void>((resolve) => pendingSleeps.push(resolve))
        : Promise.resolve();
    },
    log: (message) => logs.push(message),
    stopTimeoutMs: 25_000,
    pid: 4242,
  });
  return { supervisor, delays, environments, stopTimeouts, logs, starts: () => index };
}

describe("superviseEva", () => {
  test("restarts Eva after each crash, and stops with her exit code after a clean stop", async () => {
    const fake = fakeSupervisor([{ exit: 1 }, { exit: 1 }, { exit: 0 }]);
    expect(await fake.supervisor.done).toBe(0);
    expect(fake.starts()).toBe(3);
    expect(fake.delays).toEqual([5_000, 10_000]);
    expect(fake.logs.join("\n")).toContain("exit code 1");
  });

  test("never restarts after bad settings or a second instance", async () => {
    expect(await fakeSupervisor([{ exit: 2 }]).supervisor.done).toBe(2);
    expect(await fakeSupervisor([{ exit: 3 }]).supervisor.done).toBe(3);
  });

  test("an update restarts Eva at once, and it does not raise the next crash's delay", async () => {
    const fake = fakeSupervisor([{ exit: 1 }, { exit: 4 }, { exit: 1 }, { exit: 0 }]);
    expect(await fake.supervisor.done).toBe(0);
    expect(fake.delays).toEqual([5_000, 0, 10_000]);
  });

  test("a run of ten minutes or more resets the crash delay", async () => {
    const fake = fakeSupervisor([{ exit: 1 }, { exit: 1 }, { exit: 1, lastsMs: 10 * 60_000 }, { exit: 0 }]);
    await fake.supervisor.done;
    expect(fake.delays).toEqual([5_000, 10_000, 5_000]);
  });

  test("marks the child with the supervisor's pid, so an update exits 4 instead of starting a copy", async () => {
    const fake = fakeSupervisor([{ exit: 0 }]);
    await fake.supervisor.done;
    expect(fake.environments[0]).toEqual({ PATH: "/bin", [supervisedVariable]: "4242" });
  });

  test("a child that cannot start counts as a crash", async () => {
    const fake = fakeSupervisor([{ exit: "fail-to-start" }, { exit: 0 }]);
    expect(await fake.supervisor.done).toBe(0);
    expect(fake.delays).toEqual([5_000]);
    expect(fake.logs.join("\n")).toContain("Could not start eva.");
  });

  test("a stop stops the running child, with a bounded wait, and never restarts it", async () => {
    const fake = fakeSupervisor([{ exit: "hold" }]);
    await Bun.sleep(0);
    fake.supervisor.stop();
    fake.supervisor.stop();
    expect(await fake.supervisor.done).toBe(0);
    expect(fake.stopTimeouts).toEqual([25_000]);
    expect(fake.starts()).toBe(1);
  });

  test("a stop during the wait after a crash ends the wait, and starts no new child", async () => {
    const fake = fakeSupervisor([{ exit: 1 }, { exit: "hold" }]);
    await Bun.sleep(0);
    expect(fake.delays).toEqual([5_000]);
    fake.supervisor.stop();
    expect(await fake.supervisor.done).toBe(0);
    expect(fake.starts()).toBe(1);
  });

  test("a stop ends the supervisor even when the child never ends, so the supervisor never hangs", async () => {
    const fake = fakeSupervisor([{ exit: "stuck" }]);
    await Bun.sleep(0);
    fake.supervisor.stop();
    expect(await fake.supervisor.done).toBe(0);
  });

  test("a stop that fails is logged, and the supervisor still ends", async () => {
    const fake = fakeSupervisor([{ exit: "stop-fails" }]);
    await Bun.sleep(0);
    fake.supervisor.stop();
    expect(await fake.supervisor.done).toBe(0);
    expect(fake.logs.join("\n")).toContain("taskkill could not start");
  });
});
