/** Tests of Eva's alerts. The shared setup is in `test/support/eva-testbed.ts` (#1043). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Alert } from "../../../src/core/alerts/alert-center.ts";
import { Eva, type EvaOptions } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { gitEnvironment } from "../../support/git-sandbox.ts";
import {
  useEvaTestbed,
  clock,
  config,
  home,
  sandbox,
  setClock,
  setEva,
  start,
  vault,
  waitFor,
} from "../../support/eva-testbed.ts";

useEvaTestbed();

describe("Eva alerts", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }

  test("a vault conflict raises an alert that names the phone fix, and the last pick clears it", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, "Notes/plan.md", "theirs\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "other");
    sandbox.git(other, "push", "-q", "origin", "main");
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    sandbox.write(vault, "Notes/plan.md", "mine\n");
    expect(await instance.sweep()).toBe("conflict");
    expect(alerts.at(-1)?.message).toContain("/conflicts");
    expect((await instance.vaultConflicts()).conflicts.map((conflict) => conflict.path)).toEqual(["Notes/plan.md"]);
    const result = await instance.resolveVaultConflict("Notes/plan.md", "mine");
    expect(result.state.status).toBe("ok");
    expect(alerts.at(-1)?.level).toBe("resolved");
  });

  test("a pick waits while an Assistant turn runs, like a sync (lessons 22, 30)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    const result = await instance.resolveVaultConflict("Notes/plan.md", "mine");
    expect(result.found).toBe(false);
    expect(result.state.status).toBe("skipped");
    expect(result.state.lastError).toContain("an Assistant or project chat");
    release();
    await turn;
  });

  test("a sync during an Assistant turn, or with no vault, says why it skipped, in a field a client can read", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    const busy = await instance.syncVault();
    expect([busy.status, busy.skipReason]).toEqual(["skipped", "assistant_busy"]);
    release();
    await turn;
    expect((await instance.syncVault()).skipReason).toBeUndefined();
    const bare = start(new FakeEngine(), { vaultPath: null });
    expect((await bare.syncVault()).skipReason).toBe("no_vault");
  });

  test("a sync also waits while a specialist chat runs a turn, since it works in the vault (#703)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.sessions.createSession({
      mode: "project",
      engine: "claude-code",
      startFolder: join(vault, "Projects", "2025-03-02-1015-coach"),
      source: "web",
      projectId: "2025-03-02-1015-coach",
    });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    expect((await instance.syncVault()).skipReason).toBe("assistant_busy");
    release();
    await turn;
    expect((await instance.syncVault()).skipReason).toBeUndefined();
  });

  test("with no vault, there is no conflict to list or resolve", async () => {
    const instance = start(new FakeEngine(), { vaultPath: null });
    expect((await instance.vaultConflicts()).conflicts).toEqual([]);
    expect((await instance.resolveVaultConflict("a.md", "mine")).found).toBe(false);
  });

  test("a vault offline for more than 30 minutes is a problem, and a good sync clears it", async () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    sandbox.git(vault, "remote", "set-url", "origin", join(home, "missing.git"));
    expect((await instance.syncVault()).status).toBe("offline");
    setClock(new Date(clock.getTime() + 20 * 60_000));
    await instance.syncVault();
    expect(alerts).toEqual([]);
    setClock(new Date(clock.getTime() + 11 * 60_000));
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["vault_sync", "warn"]]);
    expect(instance.status().problems).toHaveLength(1);
    sandbox.git(vault, "remote", "set-url", "origin", sandbox.remote);
    expect((await instance.syncVault()).status).toBe("ok");
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
    expect(instance.status().problems).toEqual([]);
  });

  test("a sync error that names a secret reaches the status with the secret hidden (#447)", async () => {
    const secret = "github-token-value-for-tests";
    const instance = start(new FakeEngine(), {}, { secrets: { githubToken: secret } });
    // Git names the remote in its error, and a remote address can hold a token.
    sandbox.git(vault, "remote", "set-url", "origin", join(home, secret, "missing.git"));
    const state = await instance.syncVault();
    expect(state.status).toBe("offline");
    expect(state.lastError).toContain("[redacted]");
    expect(state.lastError).not.toContain(secret);
    expect(instance.status().vaultSync.lastError).not.toContain(secret);
  });

  test("a check that fails for 2 hours and a failed install each raise an alert that names the step", async () => {
    let failCheck = true;
    const instance = start(
      new FakeEngine(),
      {},
      {
        updateChannel: {
          kind: "source",
          check: () =>
            failCheck
              ? Promise.reject(new Error("no network"))
              : Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: true, releases: null }),
          apply: () => Promise.reject(new Error("bun install failed")),
        },
      },
    );
    const alerts = collectAlerts(instance);
    await instance.checkForUpdate();
    // One failed check is often a laptop that woke up with no network (#541).
    expect(alerts).toEqual([]);
    setClock(new Date(clock.getTime() + 2 * 60 * 60_000));
    await instance.checkForUpdate();
    expect(alerts.at(-1)?.message).toStartWith(
      "Eva could not check for updates for 2 hours or more. The last error: no network.",
    );
    failCheck = false;
    await instance.checkForUpdate();
    expect(alerts.at(-1)?.level).toBe("resolved");
    await instance.updateNow();
    expect(alerts.at(-1)?.message).toStartWith("Eva could not install the update: bun install failed.");
    setClock(new Date(clock.getTime() + 25 * 60 * 60_000));
    await instance.backgroundTick();
    expect(instance.status().problems[0]).toStartWith("Eva could not install the update");
  });

  test("each new held-back release reaches the phone once, even across a restart", async () => {
    let releases = [{ version: "1.0.0", notes: "## Breaking changes\n\n- feat!: rename the keys\n" }];
    const options: Partial<EvaOptions> = {
      updateChannel: {
        kind: "executable",
        check: () =>
          Promise.resolve({ current: "0.2.0", latest: releases[0]?.version ?? "", available: true, releases }),
        apply: () => Promise.reject(new Error("not in this test")),
      },
    };
    const first = start(new FakeEngine(), {}, options);
    const alerts = collectAlerts(first);
    await first.checkForUpdate();
    await first.checkForUpdate();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["update_held_back", "news"]]);
    expect(alerts[0]?.message).toContain("1.0.0");
    expect(alerts[0]?.message).toContain("can break");
    first.stop();
    const second = start(new FakeEngine(), {}, options);
    const later = collectAlerts(second);
    await second.checkForUpdate();
    expect(later).toEqual([]);
    releases = [{ version: "1.1.0", notes: "" }, ...releases];
    await second.checkForUpdate();
    expect(later).toHaveLength(1);
    expect(later[0]?.message).toContain("1.1.0");
  });

  test("a failed engine update reaches the phone as an alert, and a good one clears it", async () => {
    let refuse = true;
    const instance = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: { githubToken: "secret-value-for-tests" },
      engines: [new FakeEngine()],
      runner: {
        run: (command) =>
          Promise.resolve(
            command[1] === "update" && refuse
              ? { exitCode: 1, stdout: "", stderr: "Installed with npm. Token secret-value-for-tests.\n" }
              : { exitCode: 0, stdout: "2.1.0\n", stderr: "" },
          ),
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      claudeExecutable: "/opt/claude",
    });
    setEva(instance);
    const alerts = collectAlerts(instance);
    instance.updateEngine();
    await waitFor(() => alerts.length >= 1);
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["engine_update", "warn"]]);
    expect(alerts[0]?.message).toStartWith("The Claude Code update failed: Installed with npm.");
    expect(alerts[0]?.message).not.toContain("secret-value-for-tests");
    expect(instance.engineUpdateStatus()?.last?.detail).not.toContain("secret-value-for-tests");
    // A tick with no waiting update never reports the old failure again, not even a day later.
    setClock(new Date(clock.getTime() + 25 * 60 * 60_000));
    await instance.backgroundTick();
    expect(alerts).toHaveLength(1);
    refuse = false;
    // The answer to a press still carries the old result while the new run starts.
    expect(instance.updateEngine()?.last?.detail).not.toContain("secret-value-for-tests");
    await waitFor(() => alerts.length >= 2);
    expect(alerts[1]?.level).toBe("resolved");
  });

  test("a schedule that fails to fire raises an alert named after the schedule", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    // The chat list cannot be saved, so the firing's chat cannot start.
    mkdirSync(join(home, "state", "sessions.json"), { recursive: true });
    setClock(new Date("2026-10-14T10:45:00Z"));
    await instance.schedules?.tick();
    expect(alerts.map((alert) => alert.key)).toEqual(["schedule:lunch"]);
    expect(alerts[0]?.message).toContain("Lunch");
  });

  test("a scheduled prompt whose turn fails raises the schedule's alert", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine(() => [{ kind: "turn_failed", reason: "You hit the usage limit." }]));
    const alerts = collectAlerts(instance);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    setClock(new Date("2026-10-14T10:45:00Z"));
    await instance.schedules?.tick();
    await waitFor(() => alerts.some((alert) => alert.key === "schedule:lunch"));
    expect(alerts.find((alert) => alert.key === "schedule:lunch")?.message).toContain("You hit the usage limit.");
    expect(instance.schedules?.list().schedules[0]?.lastRun).toMatchObject({ failed: true });
  });

  test("a scheduled turn that the person stops raises no alert, and the run counts as good", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => {
          resolve();
        });
      });
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const instance = start(engine);
    const alerts = collectAlerts(instance);
    instance.schedules?.subscribe(() => true);
    await instance.schedules?.tick();
    setClock(new Date("2026-10-14T10:45:00Z"));
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    const [session] = instance.sessions.list();
    instance.sessions.stop(session?.id ?? "");
    await instance.idle();
    await Bun.sleep(0);
    expect(alerts.filter((alert) => alert.key === "schedule:lunch")).toEqual([]);
    expect(instance.schedules?.list().schedules[0]?.lastRun).toMatchObject({ failed: false });
  });

  test("a new schedule makes no problem in the status: it needs no setup card (#855)", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    await instance.schedules?.tick();
    expect(instance.status().problems).toEqual([]);
    expect(alerts).toEqual([]);
  });

  test("a front end reports its own problem, and the status carries it", () => {
    const instance = start(new FakeEngine());
    instance.reportProblem("telegram_poll", {
      level: "error",
      message: "Another program polls the bot.",
      resolvedMessage: "Telegram works again.",
    });
    expect(instance.status().problems).toEqual(["Another program polls the bot."]);
    // The web page picks the button of a problem from its key, never from its text.
    expect(instance.status().problemDetails).toEqual([
      {
        key: "telegram_poll",
        level: "error",
        message: "Another program polls the bot.",
        hidden: false,
        since: expect.any(String) as string,
      },
    ]);
    instance.reportProblem("telegram_poll", null);
    expect(instance.status().problems).toEqual([]);
    expect(instance.status().problemDetails).toEqual([]);
  });

  test("a hidden problem stays hidden after a restart, and only an open problem can be hidden (#541)", () => {
    const problem = { level: "warn", message: "The bot is slow.", resolvedMessage: "Telegram works again." } as const;
    const first = start(new FakeEngine());
    first.reportProblem("telegram_poll", problem);
    expect(first.hideProblem("telegram_poll")).toBe(true);
    expect(first.status().problemDetails[0]?.hidden).toBe(true);
    expect(first.hideProblem("vault_sync")).toBe(false);
    first.stop();
    const second = start(new FakeEngine());
    const alerts = collectAlerts(second);
    second.reportProblem("telegram_poll", problem);
    expect(alerts).toEqual([]);
    expect(second.status().problemDetails).toEqual([
      {
        key: "telegram_poll",
        level: "warn",
        message: "The bot is slow.",
        hidden: true,
        since: expect.any(String) as string,
      },
    ]);
  });

  test("the notification history survives a restart, and the person marks entries as read (#566)", () => {
    const problem = { level: "warn", message: "The bot is slow.", resolvedMessage: "Telegram works again." } as const;
    const first = start(new FakeEngine());
    first.reportProblem("telegram_poll", problem);
    first.reportProblem("telegram_poll", null);
    expect(first.status().problemDetails).toEqual([]);
    first.reportProblem("vault_sync", problem);
    const startedAt = first.status().problemDetails[0]?.since;
    first.stop();
    const second = start(new FakeEngine());
    second.reportProblem("vault_sync", problem);
    expect(second.status().problemDetails[0]?.since).toBe(startedAt);
    const entries = second.notifications().entries;
    expect(entries.map((entry) => `${entry.key}:${entry.level}`)).toEqual([
      "telegram_poll:warn",
      "telegram_poll:resolved",
      "vault_sync:warn",
    ]);
    expect(second.markNotificationsRead({ seqs: [entries[0]?.seq ?? 0] }).entries.map((entry) => entry.read)).toEqual([
      true,
      false,
      false,
    ]);
    const all = second.markNotificationsRead({ all: true });
    expect(all.entries.every((entry) => entry.read)).toBe(true);
    expect(second.status().problemDetails[0]?.hidden).toBe(true);
  });

  test("an expired engine login is a problem with its own key until a turn of that engine works", async () => {
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 1
        ? [{ kind: "turn_failed", reason: "The login expired.", loginExpired: true }]
        : FakeEngine.answer(request, "ok"),
    );
    const instance = start(engine);
    const alerts = collectAlerts(instance);
    const chat = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(chat.id, "hello");
    await instance.idle();
    expect(instance.status().problemDetails).toEqual([
      {
        key: "engine_login:claude-code",
        level: "error",
        message: expect.stringContaining("Claude Code login") as string,
        hidden: false,
        since: expect.any(String) as string,
      },
    ]);
    await instance.sessions.send(chat.id, "hello again");
    await instance.idle();
    expect(instance.status().problemDetails).toEqual([]);
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([
      ["engine_login:claude-code", "error"],
      ["engine_login:claude-code", "resolved"],
    ]);
  });

  test("a turn that fails for another reason leaves the login problem alone", async () => {
    const engine = new FakeEngine(() => [{ kind: "turn_failed", reason: "The network is down." }]);
    const instance = start(engine);
    const chat = instance.createAssistantSession({ source: "cli" });
    await instance.sessions.send(chat.id, "hello");
    await instance.idle();
    expect(instance.status().problemDetails).toEqual([]);
  });

  test("a default engine with no program raises an alert, which asks for a restart once the program is back", async () => {
    let piProgram: string | null = null;
    const instance = start(
      new FakeEngine(),
      { engines: { ...defaultConfig.engines, default: "pi" } },
      { locateEngine: (engine) => (engine === "pi" ? piProgram : null) },
    );
    const alerts = collectAlerts(instance);
    instance.noticeDefaultEngine();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["default_engine", "error"]]);
    expect(instance.status().problems[0]).toStartWith("Eva finds no pi program, so chats fail.");

    // The install happens while Eva runs: only a restart loads the engine.
    piProgram = "/opt/pi/bin/pi";
    await instance.backgroundTick();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([
      ["default_engine", "error"],
      ["default_engine", "resolved"],
      ["default_engine_restart", "warn"],
    ]);
    expect(instance.status().problems).toHaveLength(1);
    expect(instance.status().problems[0]).toStartWith("The pi program is installed now");
  });

  test("a loaded default engine raises no alert", () => {
    const instance = start(new FakeEngine(), {}, { locateEngine: () => null });
    const alerts = collectAlerts(instance);
    instance.noticeDefaultEngine();
    expect(alerts).toEqual([]);
    expect(instance.status().problems).toEqual([]);
  });

  test("a start after an unclean exit sends one alert that stays out of the problems", () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    instance.reportUncleanExit();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["unclean_exit", "warn"]]);
    expect(instance.status().problems).toEqual([]);
  });

  test("the recent log entries come from the instance's log folder, at most 100", () => {
    const instance = start(new FakeEngine());
    const logs = homePaths(home).logsFolder;
    mkdirSync(logs, { recursive: true });
    const records = Array.from({ length: 120 }, (_, index) =>
      JSON.stringify({ at: "2026-10-14T10:00:00.000Z", level: "warn", message: `Warning ${String(index)}.` }),
    );
    writeFileSync(join(logs, "eva-2026-10-14.jsonl"), records.join("\n") + "\n");
    expect(instance.recentLogs({ minimumLevel: "warn", limit: 5 }).map((entry) => entry.message)).toEqual([
      "Warning 115.",
      "Warning 116.",
      "Warning 117.",
      "Warning 118.",
      "Warning 119.",
    ]);
    expect(instance.recentLogs({ minimumLevel: "warn", limit: 500 })).toHaveLength(100);
    expect(instance.recentLogs({ minimumLevel: "error", limit: 0 })).toEqual([]);
  });

  test("a restart on request goes through the update restart path", async () => {
    const restarts: string[] = [];
    const instance = start(new FakeEngine(), {}, { restartForUpdate: () => restarts.push("restart") });
    instance.restart();
    await waitFor(() => restarts.length === 1);
    expect(restarts).toEqual(["restart"]);
  });
});
