import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../../../src/core/checks.ts";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import { loadSettings, vaultSettingsPath } from "../../../src/core/settings/settings.ts";
import { claimHub, hubFilePath } from "../../../src/core/instance/hub.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import type { ProcessRunner } from "../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { fakeGithub } from "../../support/fake-github.ts";
import type { GithubGet } from "../../../src/core/projects/repository-facts.ts";
import type { SetupReport } from "../../../src/core/projects/repository-setup.ts";
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

describe("repository setup", () => {
  const referenceFiles = { "AGENTS.md": "rules", ".claude/settings.json": '{"permissions":{"allow":["Read"]}}' };

  test("each repository of a project gets a report; one that is not on GitHub gets a reason", async () => {
    sandbox.write(
      vault,
      "Projects/2025-04-01-0900-other-app/AGENTS.md",
      `---\ncreated: 2025-04-01T09:00\nstatus: active\nrepos:\n  - https://github.com/owner/other-app.git\n  - ${sandbox.remote}\n---\n`,
    );
    const asked: string[] = [];
    const github = fakeGithub({
      "guplem/eva": { files: referenceFiles, labels: ["bug"] },
      "owner/other-app": { files: {}, labels: [] },
    });
    const withGithub = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [new FakeEngine()],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      githubGet: (path, raw) => {
        asked.push(path);
        return github(path, raw);
      },
    });
    const reports = await withGithub.repositorySetup("2025-04-01-0900-other-app");
    withGithub.stop();
    expect(reports.map((report) => report.slug)).toEqual(["owner/other-app", null]);
    expect(reports[0]?.sections.map((section) => section.title)).toContain("Security");
    expect(reports[1]?.problem).toBe("Only a repository on GitHub has a setup report.");
    expect(asked).toContain("repos/guplem/eva");
    expect(String(await withGithub.repositorySetup("missing").catch((error: unknown) => error))).toContain(
      "No project",
    );
  });

  test("a reference with an unreadable part, or an archived repository, gives a reason, never false lights", async () => {
    sandbox.write(
      vault,
      "Projects/2025-04-01-0900-other-app/AGENTS.md",
      "---\ncreated: 2025-04-01T09:00\nstatus: active\nrepos:\n  - https://github.com/owner/other-app\n---\n",
    );
    const reportFor = async (github: GithubGet): Promise<SetupReport | undefined> => {
      const instance = new Eva({
        paths: homePaths(home),
        config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => new Date(),
        basePrompt: "Base.",
        githubGet: github,
      });
      const reports = await instance.repositorySetup("2025-04-01-0900-other-app");
      instance.stop();
      return reports[0];
    };
    const target = { files: {}, labels: [] };
    const complete = fakeGithub({
      "guplem/eva": { files: referenceFiles, labels: ["bug"] },
      "owner/other-app": target,
    });
    const noLabels: GithubGet = (path, raw) =>
      path.startsWith("repos/guplem/eva/labels") ? Promise.resolve({ status: 500, body: "" }) : complete(path, raw);
    expect((await reportFor(noLabels))?.problem).toContain("could not read all of her reference repository");

    const archived = fakeGithub({
      "guplem/eva": { files: referenceFiles, labels: ["bug"] },
      "owner/other-app": { ...target, repository: { archived: true } },
    });
    expect((await reportFor(archived))?.problem).toBe("This repository is archived, so it takes no changes.");
  });

  test("when GitHub cannot be read, each report says why", async () => {
    sandbox.write(
      vault,
      "Projects/2025-04-01-0900-other-app/AGENTS.md",
      "---\ncreated: 2025-04-01T09:00\nstatus: active\nrepos:\n  - https://github.com/owner/other-app\n---\n",
    );
    const failing: ProcessRunner = { run: () => Promise.reject(new Error("spawn gh ENOENT")) };
    const withoutGh = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [new FakeEngine()],
      runner: failing,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
    });
    const reports = await withoutGh.repositorySetup("2025-04-01-0900-other-app");
    withoutGh.stop();
    expect(reports[0]?.problem).toContain("gh auth login");
    expect(reports[0]?.sections).toEqual([]);
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
        engineEnvironment: {},
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
        engineEnvironment: {},
        claudeExecutable: null,
        telegramToken: null,
      }),
    ).toMatchObject({ ok: false });
  });

  test("the engine and GitHub checks run their programs", async () => {
    const inputs = {
      vaultPath: vault,
      environment: {},
      engineEnvironment: {},
      claudeExecutable: "/bin/claude",
      telegramToken: null,
    };
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

  test("the engine check runs claude with the engine environment, never the git one (lesson 96)", async () => {
    const seen: Readonly<Record<string, string>>[] = [];
    const recordingRunner: ProcessRunner = {
      run: (_command, options) => {
        seen.push(options.environment);
        return Promise.resolve({ exitCode: 0, stdout: "2.1.286 (Claude Code)\n", stderr: "" });
      },
    };
    await runCheck("engine", {
      vaultPath: vault,
      runner: recordingRunner,
      environment: { GITHUB_TOKEN: "github-token-value" },
      engineEnvironment: { CLAUDE_CONFIG_DIR: "/engines/claude" },
      claudeExecutable: "/bin/claude",
      telegramToken: null,
    });
    expect(seen).toEqual([{ CLAUDE_CONFIG_DIR: "/engines/claude", GIT_TERMINAL_PROMPT: "0" }]);
  });

  test("the Telegram check asks Telegram who the bot is, and never shows the token", async () => {
    const telegram = new FakeTelegram();
    const inputs = {
      vaultPath: null,
      runner: okRunner,
      environment: {},
      engineEnvironment: {},
      claudeExecutable: null,
    };
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

describe("the hub", () => {
  test("this machine is the hub until another machine claims it, and takes it back with becomeHub", async () => {
    const changes: string[] = [];
    eva.onRoleChange((role) => changes.push(role));
    expect(eva.status()).toMatchObject({ role: "hub", hub: null });
    claimHub(vault, "another-machine", new Date());
    await eva.backgroundTick();
    expect(eva.status()).toMatchObject({ role: "satellite", hub: "another-machine" });
    const status = await eva.becomeHub();
    expect(status.role).toBe("hub");
    expect(status.hub).toBe(status.machine);
    expect(changes).toEqual(["satellite", "hub"]);
    expect(sandbox.git(sandbox.remote, "show", "main:.eva/hub.json")).toContain(status.machine);
    await eva.becomeHub();
    expect(changes).toEqual(["satellite", "hub"]);
  });

  test("a broken claim file keeps the role that this machine had", async () => {
    const changes: string[] = [];
    eva.onRoleChange((role) => changes.push(role));
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(hubFilePath(vault), "{ not json");
    await eva.backgroundTick();
    expect(eva.role()).toBe("hub");
    claimHub(vault, "another-machine", new Date());
    await eva.backgroundTick();
    writeFileSync(hubFilePath(vault), "{ not json");
    await eva.backgroundTick();
    expect(eva.role()).toBe("satellite");
    expect(changes).toEqual(["satellite"]);
  });

  test("an unsubscribed listener hears nothing", async () => {
    const changes: string[] = [];
    const unsubscribe = eva.onRoleChange((role) => changes.push(role));
    unsubscribe();
    claimHub(vault, "another-machine", new Date());
    await eva.backgroundTick();
    expect(changes).toEqual([]);
  });
});
