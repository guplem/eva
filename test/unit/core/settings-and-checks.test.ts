import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../../src/core/checks.ts";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths, loadConfig } from "../../../src/core/instance/home.ts";
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
    expect(loadConfig(homePaths(home))).toMatchObject({
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
