import { describe, expect, test } from "bun:test";
import {
  Updater,
  type UpdateChannel,
  type UpdateCheck,
  type UpdateFrequency,
} from "../../../../src/core/updates/updater.ts";
import type { UpdatePolicy } from "../../../../src/core/updates/release-policy.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
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
  let found: UpdateCheck | Error = { current: "aaa1111", latest: "bbb2222", available: true, releases: null };
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
      return Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: false, releases: null });
    },
  };
  const updater = new Updater({
    channel,
    frequency: () => frequency,
    policy: () => "minor",
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

describe("Updater", () => {
  test("before a check, the status knows the channel and the settings only", () => {
    expect(harness().updater.status()).toEqual({
      kind: "source",
      frequency: "daily",
      install: "minor",
      phase: "idle",
      current: null,
      latest: null,
      available: false,
      target: null,
      heldBack: null,
      releases: [],
      lastCheckAt: null,
      lastError: null,
      failedStep: null,
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
    expect(await run.updater.check()).toMatchObject({ lastError: "offline", failedStep: "check" });
    run.setFound({ current: "aaa1111", latest: "aaa1111", available: false, releases: null });
    expect(await run.updater.check()).toMatchObject({ lastError: null, failedStep: null });
  });

  test("update now installs and restarts when no chat runs", async () => {
    const { updater, calls, logs } = harness();
    expect((await updater.updateNow()).phase).toBe("restarting");
    expect(calls).toEqual(["check", "apply", "restart"]);
    expect(logs).toEqual(["info: Eva updated; she restarts."]);
  });

  test("update now does nothing when Eva is up to date or the check fails", async () => {
    const run = harness();
    run.setFound({ current: "aaa1111", latest: "aaa1111", available: false, releases: null });
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
    expect(await run.updater.updateNow()).toMatchObject({
      phase: "idle",
      lastError: "bun install failed",
      failedStep: "install",
    });
    expect(run.calls).toEqual(["check", "apply"]);
    expect(run.logs).toEqual(["warn: The update failed."]);
  });

  test("the tick checks at the frequency in the settings, and never when it is off", async () => {
    const run = harness();
    run.setFound({ current: "aaa1111", latest: "aaa1111", available: false, releases: null });
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

describe("Updater restart", () => {
  test("a chat that starts during the install delays the restart until it ends (lesson 92)", async () => {
    const calls: string[] = [];
    let idle = true;
    const updater = new Updater({
      channel: {
        kind: "executable",
        check: () => Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: true, releases: null }),
        apply: () => {
          // A schedule fires while the new version downloads.
          idle = false;
          return Promise.resolve({ current: "0.1.0", latest: "0.2.0", available: false, releases: null });
        },
      },
      frequency: () => "off",
      policy: () => "minor",
      isIdle: () => idle,
      restart: () => calls.push("restart"),
      now: () => new Date("2026-10-17T10:00:00Z"),
    });
    expect((await updater.updateNow()).phase).toBe("restarting");
    expect(calls).toEqual([]);
    await updater.tick();
    expect(calls).toEqual([]);
    idle = true;
    await updater.tick();
    await updater.tick();
    expect(calls).toEqual(["restart"]);
  });
});

describe("Updater policy", () => {
  const releases = [
    { version: "2.0.0", notes: "## Breaking changes\n\n- feat!: rename the keys\n" },
    { version: "1.5.0", notes: "## New features\n\n- feat: voice notes\n" },
    { version: "1.4.3", notes: "## Fixes and other changes\n\n- fix: a crash\n" },
  ];

  function policyHarness(
    policy: UpdatePolicy,
    newer = releases,
  ): { updater: Updater; applied: (string | undefined)[] } {
    const applied: (string | undefined)[] = [];
    const updater = new Updater({
      channel: {
        kind: "executable",
        check: () =>
          Promise.resolve({ current: "1.4.2", latest: newer[0]?.version ?? "1.4.2", available: true, releases: newer }),
        apply: (version) => {
          applied.push(version);
          return Promise.resolve({ current: "1.4.2", latest: version ?? "?", available: false, releases: [] });
        },
      },
      frequency: () => "daily",
      policy: () => policy,
      isIdle: () => true,
      restart: () => undefined,
      now: () => new Date("2026-10-17T10:00:00Z"),
    });
    return { updater, applied };
  }

  test("a check labels each newer release and names the target and the held-back version", async () => {
    const status = await policyHarness("minor").updater.check();
    expect(status).toMatchObject({ install: "minor", target: "1.5.0", heldBack: "2.0.0", available: true });
    expect(status.releases.map(({ version, level }) => `${version} ${level}`)).toEqual([
      "2.0.0 major",
      "1.5.0 minor",
      "1.4.3 patch",
    ]);
  });

  test("each policy installs, or holds back, a patch, a minor and a major release", async () => {
    for (const [policy, installed] of [
      ["patch", "1.4.3"],
      ["minor", "1.5.0"],
      ["major", "2.0.0"],
    ] as const) {
      const run = policyHarness(policy);
      await run.updater.updateNow();
      expect(run.applied).toEqual([installed]);
    }
  });

  test("a policy that allows no newer release installs nothing and names the held-back one", async () => {
    const run = policyHarness("patch", releases.slice(0, 2));
    expect(await run.updater.updateNow()).toMatchObject({
      phase: "idle",
      available: false,
      target: null,
      heldBack: "2.0.0",
    });
    expect(run.applied).toEqual([]);
  });

  test("an update by hand installs the chosen version, past the policy", async () => {
    const run = policyHarness("patch");
    expect((await run.updater.updateNow("2.0.0")).phase).toBe("restarting");
    expect(run.applied).toEqual(["2.0.0"]);
  });

  test("an update by hand to a version that is not a newer release is refused", async () => {
    const run = policyHarness("major");
    const error = await run.updater.updateNow("1.4.1").catch((caught: unknown) => caught);
    expect(isEvaError(error, "update_failed")).toBe(true);
    expect(String(error)).toContain("1.4.1");
    expect(run.applied).toEqual([]);
  });

  test("a source checkout has no versions, so it cannot pick one, and holds nothing back", async () => {
    const run = harness();
    expect(await run.updater.check()).toMatchObject({ target: "bbb2222", heldBack: null, releases: [] });
    const error = await run.updater.updateNow("1.0.0").catch((caught: unknown) => caught);
    expect(isEvaError(error, "update_failed")).toBe(true);
    expect(run.calls).toEqual(["check", "check"]);
  });
});
