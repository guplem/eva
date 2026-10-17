import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck, type CheckInputs } from "../../../src/core/checks.ts";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import { loadSettings, vaultSettingsPath } from "../../../src/core/settings/settings.ts";
import { claimHub, hubFilePath } from "../../../src/core/instance/hub.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import type { ProcessRunner } from "../../../src/shared/process-runner.ts";
import type { EnginePort } from "../../../src/shared/engine-port.ts";
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
    run: () => Promise.resolve({ exitCode: 0, stdout: "Logged in to github.com\n", stderr: "" }),
  };
  const failingRunner: ProcessRunner = {
    run: () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "not logged in" }),
  };

  function inputs(overrides: Partial<CheckInputs> = {}): CheckInputs {
    return {
      vaultPath: null,
      runner: okRunner,
      environment: {},
      engines: [],
      engineEnvironment: {},
      redact: (text) => text.replaceAll("secret-value", "[redacted]"),
      telegramToken: null,
      githubToken: null,
      ...overrides,
    };
  }

  test("the vault check proves push access, and pushes nothing (lesson 98)", async () => {
    expect(
      await runCheck("vault", inputs({ vaultPath: vault, runner: systemProcessRunner, environment: gitEnvironment })),
    ).toEqual({ ok: true, detail: "Eva can push to the vault's remote." });
    expect(sandbox.git(sandbox.remote, "branch", "--list", "eva-access-check")).toBe("");
    expect(await runCheck("vault", inputs())).toMatchObject({ ok: false });
  });

  test("without a saved GitHub token, the GitHub check runs gh", async () => {
    expect(await runCheck("github", inputs({ runner: failingRunner }))).toEqual({ ok: false, detail: "not logged in" });
    expect(await runCheck("github", inputs())).toEqual({ ok: true, detail: "gh is logged in." });
  });

  test("with a saved GitHub token, the GitHub check asks GitHub whose token it is", async () => {
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        request.headers.get("authorization") === "Bearer good-token" && new URL(request.url).pathname === "/user"
          ? Response.json({ login: "example-owner" })
          : Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    const githubBaseUrl = `http://127.0.0.1:${String(github.port)}`;
    try {
      expect(await runCheck("github", inputs({ githubToken: "good-token", githubBaseUrl }))).toEqual({
        ok: true,
        detail: "The token belongs to @example-owner.",
      });
      expect(await runCheck("github", inputs({ githubToken: "bad-token", githubBaseUrl }))).toEqual({
        ok: false,
        detail: "GitHub refused the token.",
      });
    } finally {
      await github.stop(true);
    }
    const offline = await runCheck("github", inputs({ githubToken: "bad-token", githubBaseUrl: "http://127.0.0.1:1" }));
    expect(offline).toEqual({ ok: false, detail: "GitHub could not be reached." });
  });

  test("an engine check runs one tiny real turn in an empty folder, with nothing of Eva's added", async () => {
    let folder = "";
    let folderWasEmpty = false;
    const engine = new FakeEngine((request) => {
      folder = request.startFolder;
      folderWasEmpty = readdirSync(folder).length === 0;
      return FakeEngine.answer(request, "OK\nmore text");
    });
    const result = await runCheck("claude-code", inputs({ engines: [engine], engineEnvironment: { HOME: "/h" } }));
    expect(result).toEqual({ ok: true, detail: "Claude Code answered: OK" });
    const request = engine.requests[0];
    expect(request).toMatchObject({
      mode: "project",
      trusted: false,
      model: "default",
      appendSystemPrompt: null,
      pluginFolders: [],
      mcpServers: {},
      environment: { HOME: "/h" },
    });
    expect(request?.history.kind).toBe("new");
    expect(await request?.requestApproval({ requestId: "r", toolName: "Bash", summary: "ls" })).toBe("deny");
    expect(folderWasEmpty).toBe(true);
    expect(existsSync(folder)).toBe(false);
  });

  test("an engine check names a failed turn, a missing engine and a turn that never ends", async () => {
    const failing = new FakeEngine(() => [{ kind: "turn_failed", reason: "Not logged in: secret-value" }]);
    expect(await runCheck("claude-code", inputs({ engines: [failing] }))).toEqual({
      ok: false,
      detail: "Not logged in: [redacted]",
    });
    expect(await runCheck("pi", inputs({ engines: [failing] }))).toEqual({
      ok: false,
      detail: "Eva did not find pi on this machine.",
    });
    const silent: EnginePort = {
      name: "pi",
      async *runTurn(request) {
        await new Promise((resolve) => request.signal.addEventListener("abort", resolve));
        yield { kind: "turn_failed", reason: "aborted" };
      },
    };
    expect(await runCheck("pi", inputs({ engines: [silent], engineTimeoutMs: 20 }))).toEqual({
      ok: false,
      detail: "pi gave no answer in time.",
    });
    const broken: EnginePort = {
      name: "pi",
      runTurn() {
        throw new Error("spawn failed: secret-value");
      },
    };
    expect(await runCheck("pi", inputs({ engines: [broken] }))).toEqual({
      ok: false,
      detail: "spawn failed: [redacted]",
    });
  });

  test("the Telegram check asks Telegram who the bot is, and never shows the token", async () => {
    const telegram = new FakeTelegram();
    try {
      const result = await runCheck(
        "telegram",
        inputs({ telegramToken: telegram.token, telegramBaseUrl: telegram.baseUrl }),
      );
      expect(result).toEqual({ ok: true, detail: "@eva_test_bot" });
      telegram.failNext("getMe", 401, "Unauthorized");
      const refused = await runCheck(
        "telegram",
        inputs({ telegramToken: telegram.token, telegramBaseUrl: telegram.baseUrl }),
      );
      expect(refused).toEqual({ ok: false, detail: "Telegram refused the token." });
    } finally {
      telegram.stop();
    }
    const offline = await runCheck(
      "telegram",
      inputs({ telegramToken: "123:abc", telegramBaseUrl: "http://127.0.0.1:1" }),
    );
    expect(offline.ok).toBe(false);
    expect(offline.detail).not.toContain("123:abc");
    expect((await runCheck("telegram", inputs())).ok).toBe(false);
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
