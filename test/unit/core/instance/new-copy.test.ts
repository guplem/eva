import { describe, expect, test } from "bun:test";
import { newCopyLaunch, waitForOldCopy } from "../../../../src/core/instance/new-copy.ts";
import { supervisedVariable } from "../../../../src/core/instance/supervisor.ts";

describe("newCopyLaunch", () => {
  test("the single executable runs itself again with the same arguments", () => {
    const launch = newCopyLaunch({
      evaCommand: ["/opt/eva/eva"],
      arguments: ["--instance", "ana"],
      environment: { PATH: "/usr/bin" },
      instance: "ana",
      pid: 42,
    });
    expect(launch.command).toEqual(["/opt/eva/eva", "--instance", "ana"]);
  });

  test("a source checkout runs bun with main.ts", () => {
    const launch = newCopyLaunch({
      evaCommand: ["/usr/bin/bun", "/opt/eva/src/main.ts"],
      arguments: [],
      environment: {},
      instance: "ana",
      pid: 42,
    });
    expect(launch.command).toEqual(["/usr/bin/bun", "/opt/eva/src/main.ts"]);
  });

  test("the copy waits for this pid, runs the same Eva without a question, and carries no supervisor's pid", () => {
    const launch = newCopyLaunch({
      evaCommand: ["/opt/eva/eva"],
      arguments: [],
      environment: { PATH: "/usr/bin", [supervisedVariable]: "7", EMPTY: undefined },
      instance: "ana",
      pid: 42,
    });
    expect(launch.environment).toEqual({ PATH: "/usr/bin", EVA_INSTANCE: "ana", EVA_WAIT_FOR_PID: "42" });
  });
});

describe("waitForOldCopy", () => {
  test("returns at once without the variable, or with a bad pid", async () => {
    let checks = 0;
    const isProcessAlive = (): boolean => {
      checks += 1;
      return true;
    };
    for (const value of [undefined, "", "abc", "0", "-3", "1.5"]) {
      await waitForOldCopy({
        environment: { EVA_WAIT_FOR_PID: value },
        isProcessAlive,
        now: () => 0,
        sleep: () => Promise.resolve(),
      });
    }
    expect(checks).toBe(0);
  });

  test("waits until the old copy has gone", async () => {
    let alive = 3;
    const checked: number[] = [];
    await waitForOldCopy({
      environment: { EVA_WAIT_FOR_PID: "42" },
      isProcessAlive: (pid) => {
        checked.push(pid);
        alive -= 1;
        return alive >= 0;
      },
      now: () => 0,
      sleep: () => Promise.resolve(),
    });
    expect(checked).toEqual([42, 42, 42, 42]);
  });

  test("gives up after a minute, so a stuck old copy never blocks the new one", async () => {
    let time = 0;
    await waitForOldCopy({
      environment: { EVA_WAIT_FOR_PID: "42" },
      isProcessAlive: () => true,
      now: () => time,
      sleep: (ms) => {
        time += ms;
        return Promise.resolve();
      },
    });
    expect(time).toBeGreaterThanOrEqual(60_000);
    expect(time).toBeLessThan(61_000);
  });
});
