import { describe, expect, test } from "bun:test";
import { EngineUpdater } from "../../../../src/core/updates/engine-update.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { LogLevel } from "../../../../src/shared/logger.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

interface Harness {
  readonly updater: EngineUpdater;
  readonly commands: string[];
  readonly timeouts: number[];
  readonly logs: string[];
  readonly setIdle: (idle: boolean) => void;
}

/** A fake `claude`: each `--version` gives the next version, and `update` gives its result. */
function harness(
  versions: readonly (string | null)[],
  update: ProcessResult | Error = { exitCode: 0, stdout: "Updated.\n", stderr: "" },
): Harness {
  const commands: string[] = [];
  const timeouts: number[] = [];
  const logs: string[] = [];
  const remaining = [...versions];
  let idle = true;
  const runner: ProcessRunner = {
    run: (command, options) => {
      commands.push(command.join(" "));
      timeouts.push(options.timeoutMs);
      if (command[1] === "update") return update instanceof Error ? Promise.reject(update) : Promise.resolve(update);
      const version = remaining.shift() ?? null;
      return Promise.resolve(
        version === null
          ? { exitCode: 1, stdout: "", stderr: "broken\n" }
          : { exitCode: 0, stdout: `${version} (Claude Code)\n`, stderr: "" },
      );
    },
  };
  const updater = new EngineUpdater({
    executable: "/opt/claude",
    runner,
    environment: { PATH: "/bin" },
    isIdle: () => idle,
    now: () => new Date("2026-10-17T10:00:00Z"),
    logger: { log: (level: LogLevel, message: string) => logs.push(`${level}: ${message}`) },
  });
  return {
    updater,
    commands,
    timeouts,
    logs,
    setIdle: (value) => {
      idle = value;
    },
  };
}

describe("EngineUpdater", () => {
  test("a new version after `claude update` is an update (lesson 93)", async () => {
    const { updater, commands, timeouts } = harness(["2.1.0", "2.2.0"]);
    expect(await updater.updateNow()).toEqual({
      phase: "idle",
      last: {
        outcome: "updated",
        before: "2.1.0 (Claude Code)",
        after: "2.2.0 (Claude Code)",
        detail: null,
        at: "2026-10-17T10:00:00.000Z",
      },
    });
    expect(commands).toEqual(["/opt/claude --version", "/opt/claude update", "/opt/claude --version"]);
    expect(timeouts[1]).toBeGreaterThan(timeouts[0] ?? 0);
  });

  test("the same version after a clean exit means it was already the latest, whatever the text says", async () => {
    const { updater } = harness(["2.1.0", "2.1.0"], { exitCode: 0, stdout: "Successfully updated!\n", stderr: "" });
    expect((await updater.updateNow()).last).toMatchObject({ outcome: "up_to_date", before: "2.1.0 (Claude Code)" });
  });

  test("a failed exit is a failure with the first line of the error, and the version stays", async () => {
    const { updater, logs } = harness(["2.1.0", "2.1.0"], {
      exitCode: 1,
      stdout: "",
      stderr: "Claude Code was installed with npm.\nRun npm update.\n",
    });
    expect((await updater.updateNow()).last).toMatchObject({
      outcome: "failed",
      before: "2.1.0 (Claude Code)",
      after: "2.1.0 (Claude Code)",
      detail: "Claude Code was installed with npm.",
    });
    expect(logs).toEqual(["warn: The Claude Code update failed."]);
  });

  test("a version that cannot be read after the update is a failure", async () => {
    const { updater } = harness(["2.1.0", null]);
    expect((await updater.updateNow()).last).toMatchObject({ outcome: "failed", after: null });
  });

  test("a failed exit with no error text still says why", async () => {
    const { updater } = harness(["2.1.0", "2.1.0"], { exitCode: 3, stdout: "", stderr: "" });
    expect((await updater.updateNow()).last?.detail).toBe("claude update exited with code 3.");
  });

  test("an update that cannot start or times out is a failure, never a throw", async () => {
    const { updater } = harness(["2.1.0", "2.1.0"], new EvaError("process_timeout", "/opt/claude ran past 300000 ms."));
    expect((await updater.updateNow()).last).toMatchObject({
      outcome: "failed",
      detail: "/opt/claude ran past 300000 ms.",
    });
  });

  test("a version read that throws gives no version, never a throw (lesson 94)", async () => {
    const updater = new EngineUpdater({
      executable: "/opt/claude",
      runner: { run: () => Promise.reject(new Error("no such file")) },
      environment: {},
      isIdle: () => true,
      now: () => new Date("2026-10-17T10:00:00Z"),
    });
    expect((await updater.updateNow()).last).toMatchObject({ outcome: "failed", before: null, after: null });
  });

  test("an update waits while a chat runs, and the next tick runs it (lesson 92)", async () => {
    const { updater, commands, setIdle } = harness(["2.1.0", "2.2.0"]);
    setIdle(false);
    expect(await updater.updateNow()).toEqual({ phase: "waiting_for_idle", last: null });
    expect(await updater.updateNow()).toEqual({ phase: "waiting_for_idle", last: null });
    await updater.tick();
    expect(commands).toEqual([]);
    setIdle(true);
    await updater.tick();
    expect(updater.status()).toMatchObject({ phase: "idle", last: { outcome: "updated" } });
    await updater.tick();
    expect(commands).toHaveLength(3);
  });

  test("a second request while one update runs starts nothing", async () => {
    const { updater, commands } = harness(["2.1.0", "2.2.0"]);
    const first = updater.updateNow();
    expect(updater.status().phase).toBe("updating");
    expect((await updater.updateNow()).phase).toBe("updating");
    await first;
    expect(commands).toHaveLength(3);
  });
});
