import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck, type CheckInputs } from "../../../src/core/checks.ts";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../src/core/settings/home.ts";
import { changeSettings, loadSettings, vaultSettingsPath } from "../../../src/core/settings/settings.ts";
import { claimHub, hubFilePath } from "../../../src/core/instance/hub.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import type { ProcessRunner } from "../../../src/shared/process-runner.ts";
import type { EnginePort } from "../../../src/shared/engine-port.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { fakeGithub } from "../../support/fake-github.ts";
import type { GithubRequest } from "../../../src/core/projects/repository-facts.ts";
import type { SetupReport } from "../../../src/core/projects/repository-setup.ts";
import { FakeTelegram } from "../../support/fake-telegram.ts";
import { fakeGoogle } from "../../support/fake-google.ts";
import { googleScopes } from "../../../src/core/google/google-scopes.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let vault: string;
let home: string;
let eva: Eva;
let engine: FakeEngine;

beforeEach(() => {
  sandbox = createGitSandbox();
  vault = sandbox.clone("vault");
  sandbox.write(
    vault,
    "Projects/2025-03-02-1015-example-app/AGENTS.md",
    `---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - ${sandbox.remote}\n---\n`,
  );
  home = mkdtempSync(join(tmpdir(), "eva-settings-"));
  engine = new FakeEngine();
  eva = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
    secrets: { telegramBotToken: "123:abc-telegram-token-value" },
    engines: [engine],
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
      githubRequest: (path, raw, fields) => {
        asked.push(path);
        return github(path, raw, fields);
      },
    });
    const reports = await withGithub.repositorySetup("2025-04-01-0900-other-app");
    withGithub.stop();
    expect(reports.map((report) => report.slug)).toEqual(["owner/other-app", null]);
    expect(reports[0]?.sections.map((section) => section.title)).toContain("Security");
    const security = reports[0]?.sections.find((section) => section.title === "Security")?.items ?? [];
    expect(security.find((entry) => entry.label === "Dependabot alerts")?.light).toBe("green");
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
    const reportFor = async (github: GithubRequest): Promise<SetupReport | undefined> => {
      const instance = new Eva({
        paths: homePaths(home),
        config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
        secrets: {},
        engines: [new FakeEngine()],
        runner: systemProcessRunner,
        processEnvironment: gitEnvironment,
        now: () => new Date(),
        basePrompt: "Base.",
        githubRequest: github,
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
    const noLabels: GithubRequest = (path, raw, fields) =>
      path.startsWith("repos/guplem/eva/labels")
        ? Promise.resolve({ status: 500, body: "" })
        : complete(path, raw, fields);
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
      googleOauthClientId: false,
      googleOauthClientSecret: false,
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

  test("a saved secret is redacted, kept apart from the others, and used by the next check", async () => {
    writeFileSync(homePaths(home).secrets, JSON.stringify({ localApiToken: "local-token-value" }));
    expect(eva.saveSecret("claudeOauthToken", "  sk-ant-oat-new-token-value  ")).toEqual({
      saved: true,
      restartNeeded: true,
    });
    const saved = JSON.parse(readFileSync(homePaths(home).secrets, "utf-8")) as Record<string, string>;
    expect(saved).toEqual({ localApiToken: "local-token-value", claudeOauthToken: "sk-ant-oat-new-token-value" });
    expect(eva.publicSettings().secretsSet.claudeOauthToken).toBe(true);
    expect(JSON.stringify(eva.publicSettings())).not.toContain("new-token-value");
    expect(eva.redact("token sk-ant-oat-new-token-value")).not.toContain("new-token-value");
    await eva.runCheck("claude-code");
    expect(engine.requests.at(-1)?.environment["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("sk-ant-oat-new-token-value");
    eva.saveSecret("claudeOauthToken", null);
    expect(eva.publicSettings().secretsSet.claudeOauthToken).toBe(false);
    expect(JSON.parse(readFileSync(homePaths(home).secrets, "utf-8"))).toEqual({ localApiToken: "local-token-value" });
    expect(() => eva.saveSecret("githubToken", "   ")).toThrow("empty");
  });

  test("the setup state names the vault's remote, the Telegram pairing and the engines found", async () => {
    expect(await eva.setupState()).toEqual({
      vaultRemote: sandbox.remote,
      telegram: { paired: false, pairingCode: null },
      engines: ["claude-code"],
    });
    mkdirSync(homePaths(home).stateFolder, { recursive: true });
    writeFileSync(homePaths(home).telegramPairingCode, "EVA-1234ABCD\n");
    expect((await eva.setupState()).telegram).toEqual({ paired: false, pairingCode: "EVA-1234ABCD" });
    // Without a bot token no bot reads the code, so an old code file must not show.
    eva.saveSecret("telegramBotToken", null);
    expect((await eva.setupState()).telegram).toEqual({ paired: false, pairingCode: null });
    sandbox.git(vault, "remote", "set-url", "origin", "https://x-access-token:secret@github.com/example/vault.git");
    expect((await eva.setupState()).vaultRemote).toBe("https://github.com/example/vault.git");
  });

  test("a settings change keeps a Telegram pairing that the bot saved meanwhile", () => {
    eva.updateSettings({ timeZone: "UTC" });
    changeSettings(homePaths(home), { telegram: { allowedChatId: 4242, allowedUserId: 7 } });
    eva.updateSettings({ timeZone: "Europe/Madrid" });
    expect(loadSettings(homePaths(home)).config.telegram).toEqual({ allowedChatId: 4242, allowedUserId: 7 });
  });

  test("with a broken vault settings file, a change keeps the vault's values from memory", () => {
    eva.updateSettings({ updates: { frequency: "off" } });
    writeFileSync(vaultSettingsPath(vault), "{ not json");
    eva.updateSettings({ sync: { pullIntervalMinutes: 15 } });
    expect(eva.publicSettings().config.updates.frequency).toBe("off");
    expect(readFileSync(vaultSettingsPath(vault), "utf-8")).toContain('"frequency": "off"');
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
      google: { config: defaultConfig.google, client: null, credentialsFolder: home, readServices: true },
      ...overrides,
    };
  }

  test("the Google check asks for uv, which runs the Google tools in chats", async () => {
    const google = fakeGoogle();
    try {
      const folder = join(home, "engines", "google");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "person@example.com.json"),
        JSON.stringify({
          refresh_token: "r",
          client_id: "id",
          client_secret: "s",
          scopes: googleScopes(defaultConfig.google),
        }),
      );
      const googleInputs = {
        config: { ...defaultConfig.google, email: "person@example.com" },
        client: { clientId: "id", clientSecret: "s" },
        credentialsFolder: folder,
        baseUrl: google.url,
        readServices: false,
      };
      expect(await runCheck("google", inputs({ google: googleInputs }))).toEqual({
        ok: true,
        detail: "The Google login of person@example.com works.",
      });
      const withoutUv = await runCheck("google", inputs({ google: googleInputs, runner: failingRunner }));
      expect(withoutUv.ok).toBe(false);
      expect(withoutUv.detail).toContain("no uv");
    } finally {
      google.stop();
    }
  });

  test("the Google check names the missing step, redacted", async () => {
    const google = {
      config: { ...defaultConfig.google, email: "secret-value@example.com" },
      client: { clientId: "id", clientSecret: "secret" },
      credentialsFolder: home,
      readServices: true,
    };
    expect(await runCheck("google", inputs({ google }))).toEqual({
      ok: false,
      detail: "No Google login for [redacted]@example.com on this machine. Log in to Google (step 4).",
    });
  });

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
    // pi answers an abort only over its RPC channel, so a stuck pi may never end the stream.
    const deaf: EnginePort = {
      name: "pi",
      async *runTurn() {
        await new Promise(() => undefined);
        yield { kind: "turn_failed", reason: "never" };
      },
    };
    expect(await runCheck("pi", inputs({ engines: [deaf], engineTimeoutMs: 20 }))).toEqual({
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

  test("the engine check runs its turn with the engine environment, never the git one (lesson 96)", async () => {
    const engine = new FakeEngine();
    await runCheck(
      "claude-code",
      inputs({
        engines: [engine],
        environment: { GITHUB_TOKEN: "github-token-value" },
        engineEnvironment: { CLAUDE_CONFIG_DIR: "/engines/claude" },
      }),
    );
    expect(engine.requests[0]?.environment).toEqual({ CLAUDE_CONFIG_DIR: "/engines/claude" });
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
        check: () => Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: true, releases: null }),
        apply: () => {
          steps.push("apply");
          return Promise.resolve({ current: "aaa1111", latest: "bbb2222", available: false, releases: null });
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

describe("the Google setup", () => {
  // The Google check runs `uvx --version`; CI has no uv.
  const uvRunner: ProcessRunner = {
    run: (command, options) =>
      command[0] === "uvx"
        ? Promise.resolve({ exitCode: 0, stdout: "uv 0.9.0\n", stderr: "" })
        : systemProcessRunner.run(command, options),
  };

  test("a pasted login sets the account, and the Test reads each service", async () => {
    const google = fakeGoogle();
    google.grantedScope = googleScopes(defaultConfig.google).join(" ");
    const withGoogle = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: { googleOauthClientId: "client-id", googleOauthClientSecret: "GOCSPX-client-secret-value" },
      engines: [engine],
      runner: uvRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      googleBaseUrl: google.url,
    });
    try {
      const { url } = withGoogle.startGoogleLogin();
      const state = new URL(url).searchParams.get("state") ?? "";
      expect(await withGoogle.finishGoogleLogin(`http://127.0.0.1/eva-google-login?state=${state}&code=c`)).toEqual({
        email: "person@example.com",
        restartNeeded: true,
      });
      expect(loadSettings(homePaths(home)).config.google.email).toBe("person@example.com");
      expect(await withGoogle.runCheck("google")).toEqual({
        ok: true,
        detail:
          "Eva can read Calendar, Drive, Contacts and Tasks of person@example.com. Press Restart Eva so that chats use these Google settings.",
      });
    } finally {
      withGoogle.stop();
      google.stop();
    }
  });

  test("a login with the settings of the start needs no restart; a change of access does", async () => {
    const google = fakeGoogle();
    google.grantedScope = googleScopes(defaultConfig.google).join(" ");
    const started = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, google: { ...defaultConfig.google, email: "person@example.com" } },
      secrets: { googleOauthClientId: "client-id", googleOauthClientSecret: "GOCSPX-client-secret-value" },
      engines: [engine],
      runner: uvRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      googleBaseUrl: google.url,
    });
    try {
      started.startGoogleLogin();
      expect(await started.finishGoogleLogin("the-code")).toEqual({
        email: "person@example.com",
        restartNeeded: false,
      });
      started.updateSettings({ google: { readOnly: false } });
      google.grantedScope = googleScopes({ ...defaultConfig.google, readOnly: false }).join(" ");
      started.startGoogleLogin();
      expect(await started.finishGoogleLogin("the-code")).toEqual({ email: "person@example.com", restartNeeded: true });
    } finally {
      started.stop();
      google.stop();
    }
  });

  test("the login waits for an OAuth client", () => {
    expect(() => eva.startGoogleLogin()).toThrow("step 3");
  });
});
