import { describe, expect, test } from "bun:test";
import {
  Updater,
  type UpdateChannel,
  type UpdateCheck,
  type UpdateFrequency,
} from "../../../../src/core/updates/updater.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";

interface Harness {
  readonly updater: Updater;
  readonly calls: string[];
  readonly logs: string[];
  setIdle(idle: boolean): void;
  setFrequency(frequency: UpdateFrequency): void;
  advanceHours(hours: number): void;
  setFound(found: UpdateCheck | Error): void;
  setApplyError(error: Error | null): void;
}

function harness(): Harness {
  const calls: string[] = [];
  const logs: string[] = [];
  let idle = true;
  let frequency: UpdateFrequency = "daily";
  let now = new Date("2026-10-17T10:00:00Z");
  let found: UpdateCheck | Error = { current: "aaa1111", latest: "bbb2222", available: true };
  let applyError: Error | null = null;
  const channel: UpdateChannel = {
    kind: "source",
    check: () => {
      calls.push("check");
      return found instanceof Error ? Promise.reject(found) : Promise.resolve(found);
    },
    apply: () => {
      calls.push("apply");
      if (applyError !== null) return Promise.reject(applyError);
      return Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: false });
    },
  };
  const updater = new Updater({
    channel,
    frequency: () => frequency,
    isIdle: () => idle,
    restart: () => calls.push("restart"),
    now: () => now,
    logger: { log: (level: LogLevel, message: string) => logs.push(`${level}: ${message}`) },
  });
  return {
    updater,
    calls,
    logs,
    setIdle: (value) => {
      idle = value;
    },
    setFrequency: (value) => {
      frequency = value;
    },
    advanceHours: (hours) => {
      now = new Date(now.getTime() + hours * 60 * 60_000);
    },
    setFound: (value) => {
      found = value;
    },
    setApplyError: (value) => {
      applyError = value;
    },
  };
}

describe("Updater (plan §10)", () => {
  test("before a check, the status knows the channel and the frequency only", () => {
    expect(harness().updater.status()).toEqual({
      kind: "source",
      frequency: "daily",
      phase: "idle",
      current: null,
      latest: null,
      available: false,
      lastCheckAt: null,
      lastError: null,
    });
  });

  test("a check installs nothing", async () => {
    const { updater, calls } = harness();
    expect(await updater.check()).toMatchObject({
      current: "aaa1111",
      latest: "bbb2222",
      available: true,
      lastCheckAt: "2026-10-17T10:00:00.000Z",
    });
    expect(calls).toEqual(["check"]);
  });

  test("a failed check keeps its reason, and the next good check clears it", async () => {
    const run = harness();
    run.setFound(new Error("offline"));
    expect((await run.updater.check()).lastError).toBe("offline");
    run.setFound({ current: "aaa1111", latest: "aaa1111", available: false });
    expect((await run.updater.check()).lastError).toBeNull();
  });

  test("update now installs and restarts when no chat runs", async () => {
    const { updater, calls, logs } = harness();
    expect((await updater.updateNow()).phase).toBe("restarting");
    expect(calls).toEqual(["check", "apply", "restart"]);
    expect(logs).toEqual(["info: Eva updated; she restarts."]);
  });

  test("update now does nothing when Eva is up to date or the check fails", async () => {
    const run = harness();
    run.setFound({ current: "aaa1111", latest: "aaa1111", available: false });
    expect((await run.updater.updateNow()).phase).toBe("idle");
    run.setFound(new Error("offline"));
    expect((await run.updater.updateNow()).phase).toBe("idle");
    expect(run.calls).toEqual(["check", "check"]);
  });

  test("a running chat delays the install until the next tick that finds Eva idle", async () => {
    const run = harness();
    run.setIdle(false);
    expect((await run.updater.updateNow()).phase).toBe("waiting_for_idle");
    expect((await run.updater.updateNow()).phase).toBe("waiting_for_idle");
    await run.updater.tick();
    expect(run.calls).toEqual(["check"]);
    run.setIdle(true);
    await run.updater.tick();
    expect(run.calls).toEqual(["check", "apply", "restart"]);
  });

  test("a failed install keeps Eva running and names the reason", async () => {
    const run = harness();
    run.setApplyError(new Error("bun install failed"));
    expect(await run.updater.updateNow()).toMatchObject({ phase: "idle", lastError: "bun install failed" });
    expect(run.calls).toEqual(["check", "apply"]);
    expect(run.logs).toEqual(["warn: The update failed."]);
  });

  test("the tick checks at the frequency in the settings, and never when it is off", async () => {
    const run = harness();
    run.setFound({ current: "aaa1111", latest: "aaa1111", available: false });
    await run.updater.tick();
    run.advanceHours(23);
    await run.updater.tick();
    expect(run.calls).toEqual(["check"]);
    run.advanceHours(1);
    await run.updater.tick();
    expect(run.calls).toEqual(["check", "check"]);
    run.setFrequency("hourly");
    run.advanceHours(1);
    await run.updater.tick();
    expect(run.calls).toHaveLength(3);
    run.setFrequency("off");
    run.advanceHours(24 * 30);
    await run.updater.tick();
    expect(run.calls).toHaveLength(3);
    run.setFrequency("weekly");
    await run.updater.tick();
    expect(run.calls).toHaveLength(4);
  });

  test("a check that already runs is not started twice", async () => {
    const { updater, calls } = harness();
    const first = updater.check();
    expect(updater.status().phase).toBe("checking");
    expect((await updater.check()).phase).toBe("checking");
    await updater.tick();
    await first;
    expect(calls).toEqual(["check"]);
  });
});
