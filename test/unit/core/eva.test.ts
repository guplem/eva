import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Alert } from "../../../src/core/alerts/alert-center.ts";
import { Eva, type EvaOptions } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths, type EvaConfig } from "../../../src/core/instance/home.ts";
import type { SessionEvent } from "../../../src/shared/events.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let home: string;
let eva: Eva | null;
let clock: Date;

function config(overrides: Partial<EvaConfig> = {}): EvaConfig {
  return { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid", ...overrides };
}

function start(engine: FakeEngine, overrides: Partial<EvaConfig> = {}, options: Partial<EvaOptions> = {}): Eva {
  eva = new Eva({
    ...options,
    paths: homePaths(home),
    config: config(overrides),
    secrets: { claudeOauthToken: "oauth-token-value-for-tests" },
    engines: [engine],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => clock,
    basePrompt: "Base.",
    gatherMs: 5,
  });
  // A clone of a local test remote is unknown to the trust store: answer its trust question with no.
  const instance = eva;
  instance.sessions.subscribe((event) => {
    if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
  });
  return instance;
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
}

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
  sandbox.git(vault, "add", "-A");
  sandbox.git(vault, "commit", "-q", "-m", "eva files");
  sandbox.git(vault, "push", "-q", "origin", "main");
  home = mkdtempSync(join(tmpdir(), "eva-home-"));
  eva = null;
  clock = new Date("2026-10-14T10:30:00Z");
}, gitHookTimeoutMs);
afterEach(async () => {
  await eva?.idle();
  eva?.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("Eva", () => {
  test("a schedule fires in a fresh Assistant chat named after it, and starts with the background work", async () => {
    const engine = new FakeEngine();
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(engine);
    instance.startBackgroundWork();
    instance.startBackgroundWork();
    await instance.schedules?.tick();
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    await waitFor(() => engine.requests.length === 1);
    await instance.idle();
    const [session] = instance.sessions.list();
    expect(session).toMatchObject({ title: "Lunch", source: "schedule", mode: "assistant" });
    expect(engine.requests[0]?.prompt).toEndWith("Lunch ideas?");
  });

  test("with no vault there is no scheduler", () => {
    expect(start(new FakeEngine(), { vaultPath: null }).schedules).toBeNull();
  });

  test("an Assistant chat runs at the vault root and saves what the turn wrote", async () => {
    const engine = new FakeEngine((request) => {
      writeFileSync(join(request.startFolder, "Methods", "New.md"), "A new note.\n");
      return FakeEngine.answer(request, "Stored it.");
    });
    mkdirSync(join(vault, "Methods"));
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    await instance.sessions.send(session.id, "Store a note.");

    expect(engine.requests[0]?.startFolder).toBe(vault);
    expect(engine.requests[0]?.prompt).toBe("[Local time: 2026-10-14 12:30, Europe/Madrid]\n\nStore a note.");
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Methods/New.md");
    expect(instance.status().vaultSync.status).toBe("ok");
  });

  test("the engine gets an allowlisted environment with the Claude token, and no other secret (lesson 96)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    await instance.sessions.send(session.id, "hi");
    const environment = engine.requests[0]?.environment ?? {};
    expect(environment["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("oauth-token-value-for-tests");
    expect(Object.keys(environment).some((name) => name.startsWith("GIT_AUTHOR"))).toBe(false);
  });

  test("the ownConfigFolder setting gives the instance its own Claude config folder", async () => {
    const engine = new FakeEngine();
    const instance = start(engine, {
      engines: { ...defaultConfig.engines, claudeCode: { ...defaultConfig.engines.claudeCode, ownConfigFolder: true } },
    });
    await instance.sessions.send(instance.createAssistantSession({ source: "cli", model: "default" }).id, "hi");
    expect(engine.requests[0]?.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
  });

  test("an extra instance on the same OS user gets its own Claude and gh config folders (lesson 111)", async () => {
    const engine = new FakeEngine();
    const instance = start(engine, {}, { defaultHome: join(home, "..", "default-eva-home") });
    await instance.sessions.send(instance.createAssistantSession({ source: "cli", model: "default" }).id, "hi");
    expect(engine.requests[0]?.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
    expect(engine.requests[0]?.environment["GH_CONFIG_DIR"]).toBe(join(home, "engines", "gh"));
  });

  test("the instance in the default home uses the OS user's own engine config folders", async () => {
    const engine = new FakeEngine();
    const instance = start(engine, {}, { defaultHome: join(home, ".") });
    await instance.sessions.send(instance.createAssistantSession({ source: "cli", model: "default" }).id, "hi");
    expect(engine.requests[0]?.environment["CLAUDE_CONFIG_DIR"]).toBeUndefined();
    expect(engine.requests[0]?.environment["GH_CONFIG_DIR"]).toBeUndefined();
  });

  test("a Project chat runs in a clone, which Eva creates when the project has none", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine();
    const instance = start(engine, { trust: { trustedRepositoryOwners: [] } });
    const session = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    expect(session.clone).toBe("remote-0");
    await instance.sessions.send(session.id, "fix it");
    expect(engine.requests[0]).toMatchObject({
      mode: "project",
      startFolder: join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "remote-0"),
      appendSystemPrompt: null,
      trusted: false,
    });
  });

  test("the assistant gives work to a project, and the result comes back to its chat", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine((request) =>
      FakeEngine.answer(request, request.mode === "project" ? "Fixed the login bug." : "Noted."),
    );
    const instance = start(engine);
    const assistantChat = instance.createAssistantSession({ source: "telegram", model: "default" });
    const work = await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix the login bug.",
      reportToSessionId: assistantChat.id,
    });
    expect(work).toMatchObject({ mode: "project", clone: "remote-0" });
    await waitFor(() => instance.sessions.get(assistantChat.id).turns.length === 1, 20_000);
    await instance.idle();
    expect(engine.requests.map((request) => request.mode)).toEqual(["project", "assistant"]);
    expect(engine.requests[1]?.prompt).toContain(`[Project work finished: 2025-03-02-1015-example-app, clone remote-0`);
    expect(engine.requests[1]?.prompt).toContain("Fixed the login bug.");
    const missing = await instance
      .startProjectWork({ projectId: "missing", request: "x", reportToSessionId: null })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(String(missing)).toContain("No project missing");
  });

  test("two project works at once get two different clones", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const instance = start(new FakeEngine());
    const input = { projectId: "2025-03-02-1015-example-app", request: "Fix it.", reportToSessionId: null };
    const works = await Promise.all([instance.startProjectWork(input), instance.startProjectWork(input)]);
    expect(works.map((work) => work.clone).sort()).toEqual(["remote-0", "remote-1"]);
    await instance.idle();
    const third = await instance.startProjectWork(input);
    expect(third.clone).toBe("remote-0");
  });

  test("two new clones at once get two different folders", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const instance = start(new FakeEngine());
    const clones = await Promise.all([
      instance.newClone("2025-03-02-1015-example-app"),
      instance.newClone("2025-03-02-1015-example-app"),
    ]);
    expect(clones.map((clone) => clone.name).sort()).toEqual(["remote-0", "remote-1"]);
  });

  test("the report names the clone's branch and pull request, and keeps only the end of a long answer", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const longAnswer = `START${"x".repeat(5_000)}END`;
    const engine = new FakeEngine((request) =>
      FakeEngine.answer(request, request.mode === "project" ? longAnswer : "Noted."),
    );
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [engine],
      // gh is faked: the test remote is not on GitHub.
      runner: {
        run: (command, options) =>
          command[0] === "gh"
            ? Promise.resolve({ exitCode: 0, stdout: "42\n", stderr: "" })
            : systemProcessRunner.run(command, options),
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
    });
    const instance = eva;
    instance.sessions.subscribe((event) => {
      if (event.kind === "approval_needed") instance.sessions.answerApproval(event.requestId, "deny");
    });
    const assistantChat = instance.createAssistantSession({ source: "telegram", model: "default" });
    await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix it.",
      reportToSessionId: assistantChat.id,
    });
    await waitFor(() => engine.requests.length === 2, 20_000);
    await instance.idle();
    const report = engine.requests[1]?.prompt ?? "";
    expect(report).toContain("clone remote-0, branch main, pull request #42");
    expect(report).toContain("The full answer is in the project chat.");
    expect(report).toEndWith("END");
    expect(report).not.toContain("START");
  });

  test("a failed project turn is reported as a failure", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n# Example app\n`,
    );
    const engine = new FakeEngine((request) =>
      request.mode === "project" ? [{ kind: "turn_failed", reason: "no login" }] : FakeEngine.answer(request, "ok"),
    );
    const instance = start(engine);
    const assistantChat = instance.createAssistantSession({ source: "cli", model: "default" });
    await instance.startProjectWork({
      projectId: "2025-03-02-1015-example-app",
      request: "Fix it.",
      reportToSessionId: assistantChat.id,
    });
    await waitFor(() => engine.requests.length === 2, 20_000);
    await instance.idle();
    expect(engine.requests[1]?.prompt).toContain("It failed: no login");
  });

  test("Eva's own git commands get the GitHub token, and an agent never does (lesson 96)", async () => {
    const environments: Record<string, string>[] = [];
    const engine = new FakeEngine();
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: { githubToken: "github-token-for-tests" },
      engines: [engine],
      runner: {
        run: (command, options) => {
          environments.push({ ...options.environment });
          return systemProcessRunner.run(command, options);
        },
      },
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
    });
    await eva.sweep();
    expect(environments.some((environment) => environment["EVA_GITHUB_TOKEN"] === "github-token-for-tests")).toBe(true);
    const session = eva.createAssistantSession({ source: "cli", model: "default" });
    await eva.sessions.send(session.id, "hi");
    expect(engine.requests[0]?.environment["EVA_GITHUB_TOKEN"]).toBeUndefined();
  });

  test("an agent finds an `eva` command for this instance, and the chat id of its turn", async () => {
    const engine = new FakeEngine();
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [engine],
      runner: systemProcessRunner,
      processEnvironment: { ...gitEnvironment, PATH: "/usr/bin" },
      now: () => clock,
      basePrompt: "Base.",
      gatherMs: 5,
      evaCommand: ["/opt/bun", "/opt/eva/src/main.ts"],
    });
    const session = eva.createAssistantSession({ source: "cli", model: "default" });
    await eva.sessions.send(session.id, "hi");
    const environment = engine.requests[0]?.environment ?? {};
    expect(environment["EVA_HOME"]).toBe(home);
    expect(environment["EVA_SESSION_ID"]).toBe(session.id);
    expect(environment["PATH"]?.startsWith(join(home, "bin"))).toBe(true);
    expect(readFileSync(join(home, "bin", "eva"), "utf8")).toBe(
      "#!/bin/sh\nexec '/opt/bun' '/opt/eva/src/main.ts' \"$@\"\n",
    );
    expect(readFileSync(join(home, "bin", "eva.cmd"), "utf8")).toBe('@"/opt/bun" "/opt/eva/src/main.ts" %*\r\n');
  });

  test("a Project chat reuses a free clone, and skips a clone where a session runs", async () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
    );
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request, turn) {
      if (turn === 1) await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const first = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    const running = instance.sessions.send(first.id, "long task");
    await waitFor(() => engine.requests.length >= 1);
    const second = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    expect([first.clone, second.clone]).toEqual(["remote-0", "remote-1"]);
    release();
    await running;
    const third = await instance.createProjectSession({
      projectId: "2025-03-02-1015-example-app",
      source: "cli",
      model: "default",
    });
    expect(third.clone).toBe("remote-0");
  });

  test("an unknown project is an EvaError", async () => {
    const instance = start(new FakeEngine());
    const error: unknown = await instance
      .createProjectSession({ projectId: "2020-01-01-0000-missing", source: "cli", model: "default" })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("2020-01-01-0000-missing");
  });

  test("lists and searches the vault's projects", () => {
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      "---\ncreated: 2025-03-02T10:15\nstatus: active\n---\n# Example app\n",
    );
    const instance = start(new FakeEngine());
    expect(instance.projects({ text: "example" }).map((project) => project.id)).toEqual([
      "2025-03-02-1015-example-app",
    ]);
  });

  test("the idle sweep saves a change made outside a turn", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Life/Diary/2026-10-14.md", "Written by hand.\n");
    await instance.sweep();
    expect(sandbox.git(sandbox.remote, "ls-tree", "-r", "--name-only", "main")).toContain("Life/Diary/2026-10-14.md");
  });

  test("a sync failure and a held-back secret file go to the log (lessons 16, 26)", async () => {
    const lines: string[] = [];
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      logger: { log: (level, message, details) => lines.push(`${level} ${message} ${JSON.stringify(details)}`) },
    });
    sandbox.write(vault, "Notes/keys.md", "token ghp_" + "a".repeat(36) + "\n");
    await eva.sweep();
    expect(lines.join("\n")).toContain("held back files");
    sandbox.git(vault, "remote", "set-url", "origin", join(home, "missing.git"));
    sandbox.write(vault, "Notes/other.md", "more\n");
    await eva.sweep();
    expect(lines.join("\n")).toContain('warn Vault sync failed. {"status":"offline"');
  });

  test("the background tick removes old Scratch files and old logs once a day, also with sync off", async () => {
    sandbox.write(vault, "Scratch/old.pdf", "old");
    let logCleanups = 0;
    eva = new Eva({
      paths: homePaths(home),
      config: config({ sync: { ...defaultConfig.sync, enabled: false } }),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      removeOldLogs: () => {
        logCleanups += 1;
      },
    });
    clock = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    await eva.backgroundTick();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(false);
    expect(logCleanups).toBe(1);
    await eva.backgroundTick();
    expect(logCleanups).toBe(1);
    clock = new Date(clock.getTime() + 24 * 60 * 60_000);
    await eva.backgroundTick();
    expect(logCleanups).toBe(2);
  });

  test("the Scratch cleanup waits while an Assistant turn runs (lessons 22, 30)", async () => {
    sandbox.write(vault, "Scratch/old.pdf", "old");
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine, { sync: { ...defaultConfig.sync, enabled: false } });
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    clock = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    await instance.backgroundTick();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(true);
    release();
    await turn;
    await instance.backgroundTick();
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(false);
  });

  test("a second idle sweep never starts while one runs", async () => {
    const instance = start(new FakeEngine());
    sandbox.write(vault, "Notes/local.md", "local\n");
    const first = instance.sweep();
    expect(await instance.sweep()).toBe("skipped");
    expect(await first).toBe("ok");
  });

  test("a second background tick never starts while one runs", async () => {
    let checks = 0;
    eva = new Eva({
      paths: homePaths(home),
      config: config(),
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => clock,
      basePrompt: "Base.",
      updateChannel: {
        kind: "source",
        check: () => {
          checks += 1;
          return Promise.resolve({ current: "aaa1111", latest: "aaa1111", available: false });
        },
        apply: () => Promise.resolve({ current: "aaa1111", latest: "aaa1111", available: false }),
      },
    });
    // The first tick waits on its vault fetch; a second tick at that moment must do nothing.
    const first = eva.backgroundTick();
    await eva.backgroundTick();
    expect(checks).toBe(0);
    await first;
    expect(checks).toBe(1);
  });

  test("voice notes stay off until a whisper model is configured", () => {
    expect(start(new FakeEngine()).transcribe).toBeNull();
    const voice = { ...defaultConfig.voice, modelPath: "/models/ggml-base.bin" };
    expect(start(new FakeEngine(), { voice }).transcribe).toBeInstanceOf(Function);
  });

  test("the idle sweep waits while an Assistant turn runs (lessons 22, 30)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "ok");
    });
    const instance = start(engine);
    const session = instance.createAssistantSession({ source: "cli", model: "default" });
    const turn = instance.sessions.send(session.id, "go");
    await waitFor(() => engine.requests.length >= 1);
    sandbox.write(vault, "half.md", "half written\n");
    expect(await instance.sweep()).toBe("skipped");
    release();
    await turn;
  });

  test("events reach a subscriber", async () => {
    const instance = start(new FakeEngine());
    const events: SessionEvent[] = [];
    instance.sessions.subscribe((event) => events.push(event));
    await instance.sessions.send(instance.createAssistantSession({ source: "cli", model: "default" }).id, "hi");
    expect(events.map((event) => event.kind)).toEqual(["text", "turn_finished"]);
  });

  test("with no vault configured, Eva still starts and says so", () => {
    eva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      gatherMs: 5,
    });
    expect(eva.status().vaultPath).toBeNull();
    expect(() => eva?.createAssistantSession({ source: "cli", model: "default" })).toThrow("vault");
  });
});

describe("Eva alerts", () => {
  function collectAlerts(instance: Eva): Alert[] {
    const alerts: Alert[] = [];
    instance.onAlert((alert) => {
      alerts.push(alert);
    });
    return alerts;
  }

  test("a vault offline for more than 30 minutes is a problem, and a good sync clears it", async () => {
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    sandbox.git(vault, "remote", "set-url", "origin", join(home, "missing.git"));
    expect((await instance.syncVault()).status).toBe("offline");
    clock = new Date(clock.getTime() + 20 * 60_000);
    await instance.syncVault();
    expect(alerts).toEqual([]);
    clock = new Date(clock.getTime() + 11 * 60_000);
    await instance.syncVault();
    expect(alerts.map((alert) => [alert.key, alert.level])).toEqual([["vault_sync", "warn"]]);
    expect(instance.status().problems).toHaveLength(1);
    sandbox.git(vault, "remote", "set-url", "origin", sandbox.remote);
    expect((await instance.syncVault()).status).toBe("ok");
    expect(alerts.map((alert) => alert.level)).toEqual(["warn", "resolved"]);
    expect(instance.status().problems).toEqual([]);
  });

  test("a failed update check and a failed install each raise an alert that names the step", async () => {
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
              : Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: true }),
          apply: () => Promise.reject(new Error("bun install failed")),
        },
      },
    );
    const alerts = collectAlerts(instance);
    await instance.checkForUpdate();
    expect(alerts.at(-1)?.message).toStartWith("The update check failed: no network.");
    failCheck = false;
    await instance.checkForUpdate();
    expect(alerts.at(-1)?.level).toBe("resolved");
    await instance.updateNow();
    expect(alerts.at(-1)?.message).toStartWith("The update install failed: bun install failed.");
    clock = new Date(clock.getTime() + 25 * 60 * 60_000);
    await instance.backgroundTick();
    expect(instance.status().problems[0]).toStartWith("The update install failed");
  });

  test("a schedule that fails to fire raises an alert named after the schedule", async () => {
    sandbox.write(
      vault,
      ".eva/schedules.json",
      JSON.stringify({ version: 1, schedules: [{ id: "lunch", name: "Lunch", at: "12:45", prompt: "Lunch ideas?" }] }),
    );
    const instance = start(new FakeEngine());
    const alerts = collectAlerts(instance);
    await instance.schedules?.tick();
    // The chat list cannot be saved, so the firing's chat cannot start.
    mkdirSync(join(home, "state", "sessions.json"), { recursive: true });
    clock = new Date("2026-10-14T10:45:00Z");
    await instance.schedules?.tick();
    expect(alerts.map((alert) => alert.key)).toEqual(["schedule:lunch"]);
    expect(alerts[0]?.message).toContain("Lunch");
  });

  test("a front end reports its own problem, and the status carries it", () => {
    const instance = start(new FakeEngine());
    instance.reportProblem("telegram_poll", {
      level: "error",
      message: "Another program polls the bot.",
      resolvedMessage: "Telegram works again.",
    });
    expect(instance.status().problems).toEqual(["Another program polls the bot."]);
    instance.reportProblem("telegram_poll", null);
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
