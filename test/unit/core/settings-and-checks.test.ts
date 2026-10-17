import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../../src/core/checks.ts";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/instance/home.ts";
import { loadSettings, vaultSettingsPath } from "../../../src/core/instance/settings.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import type { ProcessRunner } from "../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { FakeTelegram } from "../../support/fake-telegram.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let home: string;
let eva: Eva;

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  sandbox.write(
    vault,
    "Projects/2025-03-02-1015-example-app/AGENTS.md",
    `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
  );
  home = mkdtempSync(join(tmpdir(), "eva-settings-"));
  eva = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
    secrets: { telegramBotToken: "123:abc-telegram-token-value" },
    engines: [new FakeEngine()],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => new Date(),
    basePrompt: "Base.",
    gatherMs: 5,
  });
}, gitHookTimeoutMs);
afterEach(() => {
  eva.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("clones of a project", () => {
  test("each clone shows its branch, and no pull request when gh finds none", async () => {
    await eva.newClone("2025-03-02-1015-example-app");
    const clones = await eva.clones("2025-03-02-1015-example-app");
    expect(clones).toHaveLength(1);
    expect(clones[0]).toMatchObject({ name: "remote-0", branch: "main", pullRequest: null });
  });
});

describe("settings", () => {
  test("the public settings hold the config and only whether each secret is set", () => {
    const settings = eva.publicSettings();
    expect(settings.config.vaultPath).toBe(vault);
    expect(settings.secretsSet).toEqual({
      telegramBotToken: true,
      claudeOauthToken: false,
      githubToken: false,
      localApiToken: false,
    });
    expect(JSON.stringify(settings)).not.toContain("abc-telegram-token-value");
  });

  test("an update is checked, saved, and asks for a restart", () => {
    const result = eva.updateSettings({ timeZone: "Europe/Madrid", sync: { enabled: true, sweepSeconds: 120 } });
    expect(result).toEqual({ saved: true, restartNeeded: true });
    expect(loadSettings(homePaths(home)).config).toMatchObject({
      timeZone: "Europe/Madrid",
      sync: { sweepSeconds: 120 },
      vaultPath: vault,
    });
  });

  test("an invalid update is refused and nothing is saved", () => {
    expect(() => eva.updateSettings({ port: 5 })).toThrow("port");
  });
});

describe("runCheck", () => {
  const okRunner: ProcessRunner = {
    run: () => Promise.resolve({ exitCode: 0, stdout: "2.1.286 (Claude Code)\n", stderr: "" }),
  };
  const failingRunner: ProcessRunner = {
    run: () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "not logged in" }),
  };

  test("the vault check proves push access, and pushes nothing (lesson 98)", async () => {
    expect(
      await runCheck("vault", {
        vaultPath: vault,
        runner: systemProcessRunner,
        environment: gitEnvironment,
        claudeExecutable: null,
        telegramToken: null,
      }),
    ).toEqual({ ok: true, detail: "Eva can push to the vault's remote." });
    expect(sandbox.git(sandbox.remote, "branch", "--list", "eva-access-check")).toBe("");
    expect(
      await runCheck("vault", {
        vaultPath: null,
        runner: okRunner,
        environment: {},
        claudeExecutable: null,
        telegramToken: null,
      }),
    ).toMatchObject({ ok: false });
  });

  test("the engine and GitHub checks run their programs", async () => {
    const inputs = { vaultPath: vault, environment: {}, claudeExecutable: "/bin/claude", telegramToken: null };
    expect(await runCheck("engine", { ...inputs, runner: okRunner })).toEqual({
      ok: true,
      detail: "2.1.286 (Claude Code)",
    });
    expect(await runCheck("github", { ...inputs, runner: failingRunner })).toEqual({
      ok: false,
      detail: "not logged in",
    });
    expect(await runCheck("engine", { ...inputs, claudeExecutable: null, runner: okRunner })).toMatchObject({
      ok: false,
    });
  });

  test("the Telegram check asks Telegram who the bot is, and never shows the token", async () => {
    const telegram = new FakeTelegram();
    const inputs = { vaultPath: null, runner: okRunner, environment: {}, claudeExecutable: null };
    try {
      const result = await runCheck("telegram", {
        ...inputs,
        telegramToken: telegram.token,
        telegramBaseUrl: telegram.baseUrl,
      });
      expect(result).toEqual({ ok: true, detail: "@eva_test_bot" });
      telegram.failNext("getMe", 401, "Unauthorized");
      const refused = await runCheck("telegram", {
        ...inputs,
        telegramToken: telegram.token,
        telegramBaseUrl: telegram.baseUrl,
      });
      expect(refused).toEqual({ ok: false, detail: "Telegram refused the token." });
    } finally {
      telegram.stop();
    }
    const offline = await runCheck("telegram", {
      ...inputs,
      telegramToken: "123:abc",
      telegramBaseUrl: "http://127.0.0.1:1",
    });
    expect(offline.ok).toBe(false);
    expect(offline.detail).not.toContain("123:abc");
    expect((await runCheck("telegram", { ...inputs, telegramToken: null })).ok).toBe(false);
  });
});

describe("live settings, the vault fetch and updates", () => {
  test("the update frequency and the vault fetch apply at once and live in the vault", () => {
    expect(eva.updateSettings({ updates: { frequency: "weekly" }, sync: { pullIntervalMinutes: 15 } })).toEqual({
      saved: true,
      restartNeeded: false,
    });
    expect(eva.publicSettings().config.updates.frequency).toBe("weekly");
    expect(readFileSync(vaultSettingsPath(vault), "utf-8")).toContain('"frequency": "weekly"');
  });

  test("the background tick fetches the vault at the interval in the settings", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, "Notes/first.md", "first\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "first");
    sandbox.git(other, "push", "-q", "origin", "main");
    await eva.backgroundTick();
    expect(existsSync(join(vault, "Notes", "first.md"))).toBe(true);
    sandbox.write(other, "Notes/second.md", "second\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "second");
    sandbox.git(other, "push", "-q", "origin", "main");
    await eva.backgroundTick();
    expect(existsSync(join(vault, "Notes", "second.md"))).toBe(false);
    expect(await eva.syncVault()).toMatchObject({ status: "ok" });
    expect(existsSync(join(vault, "Notes", "second.md"))).toBe(true);
  });

  test("with no fetch interval, only a turn or Sync now brings changes in", async () => {
    eva.updateSettings({ sync: { pullIntervalMinutes: null } });
    const other = sandbox.clone("other");
    sandbox.write(other, "Notes/remote.md", "remote\n");
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "remote");
    sandbox.git(other, "push", "-q", "origin", "main");
    await eva.backgroundTick();
    expect(existsSync(join(vault, "Notes", "remote.md"))).toBe(false);
  });

  test("Sync now pushes this machine's changes", async () => {
    sandbox.write(vault, "Notes/local.md", "local\n");
    expect(await eva.syncVault()).toMatchObject({ status: "ok" });
    expect(sandbox.git(sandbox.remote, "log", "-1", "--format=%s")).toContain("eva: autosave");
  });

  test("without an update channel, Eva reports no updates", async () => {
    expect(eva.updateStatus()).toBeNull();
    expect(eva.status().update).toBeNull();
    expect(await eva.checkForUpdate()).toBeNull();
    expect(await eva.updateNow()).toBeNull();
  });

  test("with an update channel, Update now installs and asks for a restart", async () => {
    const steps: string[] = [];
    const updating = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: null },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      updateChannel: {
        kind: "source",
        check: () => Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: true }),
        apply: () => {
          steps.push("apply");
          return Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: false });
        },
      },
      restartForUpdate: () => steps.push("restart"),
    });
    expect(await updating.checkForUpdate()).toMatchObject({ available: true, phase: "idle" });
    expect(await updating.syncVault()).toMatchObject({ status: "skipped" });
    expect((await updating.updateNow())?.phase).toBe("restarting");
    expect(steps).toEqual(["apply", "restart"]);
    updating.stop();
  });
});
