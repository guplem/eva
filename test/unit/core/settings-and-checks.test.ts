import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCheck, type CheckInputs } from "../../../src/core/checks.ts";
import { Eva } from "../../../src/core/eva.ts";
import { defaultConfig, homePaths, loadSecrets } from "../../../src/core/settings/home.ts";
import { changeSettings, loadSettings, vaultSettingsPath } from "../../../src/core/settings/settings.ts";
import { claimHub, hubFilePath } from "../../../src/core/instance/hub.ts";
import { loadGitHubAccount, saveGitHubAccount } from "../../../src/core/instance/commit-identity.ts";
import { systemProcessRunner } from "../../../src/shared/process-runner.ts";
import { isEvaError } from "../../../src/shared/errors.ts";
import type { ProcessRunner } from "../../../src/shared/process-runner.ts";
import type { EnginePort } from "../../../src/shared/engine-port.ts";
import { FakeEngine } from "../../support/fake-engine.ts";
import { fakeGh } from "../../support/fake-gh.ts";
import { ghInstallRunner, serveGhRelease } from "../../support/fake-gh-release.ts";
import { fakeGithub } from "../../support/fake-github.ts";
import type { GithubRequest } from "../../../src/core/projects/repository-facts.ts";
import type { SetupReport } from "../../../src/core/projects/repository-setup.ts";
import { FakeTelegram } from "../../support/fake-telegram.ts";
import { fakeGoogle } from "../../support/fake-google.ts";
import { googleScopes } from "../../../src/core/google/google-scopes.ts";
import { googleCredentialsFolder, readGoogleCredential } from "../../../src/core/google/google-login.ts";
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
    runner: fakeGh(systemProcessRunner),
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
      runner: fakeGh(systemProcessRunner),
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
        runner: fakeGh(systemProcessRunner),
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
    expect(reports[0]?.problem).toContain("press Log in with GitHub");
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
    expect(await eva.saveSecret("claudeOauthToken", "  sk-ant-oat-new-token-value  ")).toEqual({
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
    await eva.saveSecret("claudeOauthToken", null);
    expect(eva.publicSettings().secretsSet.claudeOauthToken).toBe(false);
    expect(JSON.parse(readFileSync(homePaths(home).secrets, "utf-8"))).toEqual({ localApiToken: "local-token-value" });
    const refused = await eva.saveSecret("githubToken", "   ").then(
      () => "saved",
      (error: unknown) => String(error),
    );
    expect(refused).toContain("empty");
  });

  test("a Google client id pasted as a link is saved bare, and one that is no client id is refused (#323)", async () => {
    const id = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
    await eva.saveSecret("googleOauthClientId", `https://${id}/`);
    await eva.saveSecret("googleOauthClientSecret", ' "GOCSPX-abc" ');
    const saved = JSON.parse(readFileSync(homePaths(home).secrets, "utf-8")) as Record<string, string>;
    expect(saved["googleOauthClientId"]).toBe(id);
    expect(saved["googleOauthClientSecret"]).toBe("GOCSPX-abc");
    const refused = await eva.saveSecret("googleOauthClientId", "GOCSPX-abc").then(
      () => "saved",
      (error: unknown) => String(error),
    );
    expect(refused).toContain("not a Google client id");
    const after = JSON.parse(readFileSync(homePaths(home).secrets, "utf-8")) as Record<string, string>;
    expect(after["googleOauthClientId"]).toBe(id);
  });

  test("the setup state names the vault's remote, the Telegram pairing and the engines found", async () => {
    expect(await eva.setupState()).toMatchObject({
      vaultRemote: sandbox.remote,
      telegram: { paired: false, pairingCode: null },
      engines: ["claude-code"],
    });
    mkdirSync(homePaths(home).stateFolder, { recursive: true });
    writeFileSync(homePaths(home).telegramPairingCode, "EVA-1234ABCD\n");
    expect((await eva.setupState()).telegram).toEqual({ paired: false, pairingCode: "EVA-1234ABCD" });
    // Without a bot token no bot reads the code, so an old code file must not show.
    await eva.saveSecret("telegramBotToken", null);
    expect((await eva.setupState()).telegram).toEqual({ paired: false, pairingCode: null });
    sandbox.git(vault, "remote", "set-url", "origin", "https://x-access-token:secret@github.com/example/vault.git");
    expect((await eva.setupState()).vaultRemote).toBe("https://github.com/example/vault.git");
  });

  test("the setup progress reads what Eva knows, and keeps the last result of each Test", async () => {
    const steps = (await eva.setupState()).progress;
    expect(steps.find((step) => step.key === "vault")?.state).toBe("done");
    expect(steps.find((step) => step.key === "engine")?.state).toBe("missing");
    expect(eva.status().setupMissing).toBe(steps.filter((step) => step.state === "missing").length);
    expect(eva.status().chatBlocker).toBe("engine");
    await eva.saveSecret("claudeOauthToken", "sk-ant-oat-a-token-value");
    // The engine reads the token at start, so a chat still cannot answer before a restart.
    expect(eva.status().chatBlocker).toBe("restart");
    await eva.saveSecret("telegramBotToken", null);
    await eva.runCheck("telegram");
    const after = (await eva.setupState()).progress;
    expect(after.find((step) => step.key === "engine")?.state).toBe("done");
    expect(after.find((step) => step.key === "telegram")?.lastCheck).toMatchObject({
      ok: false,
      detail: expect.stringContaining("No Telegram bot token") as string,
    });
  });

  test("a chat keeps working when the files lose the token that the running engine holds", () => {
    const running = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: { claudeOauthToken: "sk-ant-oat-running-token" },
      engines: [new FakeEngine()],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
    });
    try {
      expect(running.status().chatBlocker).toBeNull();
    } finally {
      running.stop();
    }
  });

  test("the setup state says when Eva needs a restart to use a token that the files hold", async () => {
    writeFileSync(homePaths(home).secrets, JSON.stringify({ telegramBotToken: "123:abc-telegram-token-value" }));
    expect((await eva.setupState()).restartNeeded).toBe(false);
    writeFileSync(
      homePaths(home).secrets,
      JSON.stringify({ telegramBotToken: "123:abc-telegram-token-value", claudeOauthToken: "sk-ant-oat-new" }),
    );
    expect((await eva.setupState()).restartNeeded).toBe(true);
  });

  test("a step that `eva setup` saves in the files shows as done at once, with no restart", async () => {
    const engineStep = async (): Promise<string | undefined> =>
      (await eva.setupState()).progress.find((step) => step.key === "engine")?.state;
    expect(await engineStep()).toBe("missing");
    writeFileSync(homePaths(home).secrets, JSON.stringify({ claudeOauthToken: "sk-ant-oat-from-the-terminal" }));
    expect(await engineStep()).toBe("done");
  });

  test("the instance's own Claude Code login and pi login count as an engine login", async () => {
    mkdirSync(join(home, "engines", "pi-agent"), { recursive: true });
    writeFileSync(join(home, "engines", "pi-agent", "auth.json"), JSON.stringify({ openai: {} }));
    expect((await eva.setupState()).progress.find((step) => step.key === "engine")?.state).toBe("missing");
    mkdirSync(join(home, "engines", "claude"), { recursive: true });
    writeFileSync(join(home, "engines", "claude", ".credentials.json"), "{}");
    expect((await eva.setupState()).progress.find((step) => step.key === "engine")?.state).toBe("done");
    // Claude Code reads its own login at each turn, so the chat needs no restart.
    expect(eva.status().chatBlocker).toBeNull();
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
  const okCommands: (readonly string[])[] = [];
  const okRunner: ProcessRunner = {
    run: (command) => {
      okCommands.push(command);
      return Promise.resolve({ exitCode: 0, stdout: "Logged in to github.com\n", stderr: "" });
    },
  };
  const failingRunner: ProcessRunner = {
    run: () => Promise.resolve({ exitCode: 1, stdout: "", stderr: "not logged in" }),
  };
  /** A gh of this version that has no login. */
  function ghLoggedOut(version: string): ProcessRunner {
    return {
      run: (command) =>
        Promise.resolve(
          command[1] === "--version"
            ? { exitCode: 0, stdout: `gh version ${version} (2024-01-01)\n`, stderr: "" }
            : { exitCode: 1, stdout: "", stderr: "not logged in" },
        ),
    };
  }

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
          client_id: "123456789012-clientid.apps.googleusercontent.com",
          client_secret: "s",
          scopes: googleScopes(defaultConfig.google),
        }),
      );
      const googleInputs = {
        config: { ...defaultConfig.google, email: "person@example.com" },
        client: { clientId: "123456789012-clientid.apps.googleusercontent.com", clientSecret: "s" },
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
      client: { clientId: "123456789012-clientid.apps.googleusercontent.com", clientSecret: "secret" },
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
    expect(okCommands.at(-1)).toEqual(["gh", "auth", "status", "--hostname", "github.com"]);
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
        detail: "The token belongs to @example-owner. Your agents use the same login.",
      });
      // The agents push with the instance's gh, so a good token is not enough (#244).
      expect(
        await runCheck("github", inputs({ githubToken: "good-token", githubBaseUrl, runner: ghLoggedOut("2.62.0") })),
      ).toEqual({
        ok: false,
        detail:
          "The token belongs to @example-owner, but your agents cannot push their work yet. Press Log in with GitHub again.",
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

  // A new login cannot fix a missing or old gh, so the check names gh instead of the login.
  test("with a saved GitHub token, the GitHub check says when gh is missing or too old", async () => {
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ login: "example-owner" }),
    });
    const githubBaseUrl = `http://127.0.0.1:${String(github.port)}`;
    try {
      expect(
        await runCheck("github", inputs({ githubToken: "good-token", githubBaseUrl, runner: failingRunner })),
      ).toEqual({
        ok: false,
        detail:
          "The token belongs to @example-owner, but this machine has no gh, so your agents cannot push their work. Press Log in with GitHub again: Eva installs gh first. Or press Install next to gh on the Updates page.",
      });
      expect(
        await runCheck("github", inputs({ githubToken: "good-token", githubBaseUrl, runner: ghLoggedOut("2.39.2") })),
      ).toEqual({
        ok: false,
        detail:
          "The token belongs to @example-owner, but gh 2.39.2 on this machine is too old for Eva's login. Press Log in with GitHub again: Eva installs a new gh first. Or press Update next to gh on the Updates page.",
      });
    } finally {
      await github.stop(true);
    }
  });

  test("an engine check runs one tiny model call in an empty folder, with no tools", async () => {
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
      mode: "model-call",
      trusted: false,
      // The person's own model, so the check proves the model that chats use.
      model: "default",
      prompt: "Reply with the single word OK.",
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

  test("the trusted owners apply at once, and the overview adds Eva's own GitHub account", () => {
    expect(eva.trust()).toEqual({ githubAccount: null, githubLoggedIn: false, owners: [], answers: [] });
    expect(eva.updateSettings({ trust: { trustedRepositoryOwners: ["example-org"] } })).toEqual({
      saved: true,
      restartNeeded: false,
    });
    saveGitHubAccount(homePaths(home), { id: 1234, login: "example-user", name: null });
    expect(eva.trust()).toMatchObject({ githubAccount: "example-user", owners: ["example-org"], answers: [] });
  });

  test("a saved trust answer shows without its token, and a removal makes Eva ask again", () => {
    mkdirSync(dirname(homePaths(home).trust), { recursive: true });
    writeFileSync(
      homePaths(home).trust,
      JSON.stringify({ "https://user:secret@github.com/stranger/app.git": "untrusted" }),
    );
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
    });
    try {
      expect(instance.trust().answers).toEqual([{ url: "https://github.com/stranger/app.git", decision: "untrusted" }]);
      expect(instance.forgetTrustAnswer("https://github.com/stranger/app.git").answers).toEqual([]);
      expect(readFileSync(homePaths(home).trust, "utf8")).not.toContain("stranger");
    } finally {
      instance.stop();
    }
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
      runner: fakeGh(systemProcessRunner),
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
      secrets: {
        googleOauthClientId: "123456789012-clientid.apps.googleusercontent.com",
        googleOauthClientSecret: "GOCSPX-client-secret-value",
      },
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
      secrets: {
        googleOauthClientId: "123456789012-clientid.apps.googleusercontent.com",
        googleOauthClientSecret: "GOCSPX-client-secret-value",
      },
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
      started.updateSettings({ google: { access: { calendar: "full" } } });
      google.grantedScope = googleScopes({
        ...defaultConfig.google,
        access: { ...defaultConfig.google.access, calendar: "full" },
      }).join(" ");
      started.startGoogleLogin();
      expect(await started.finishGoogleLogin("the-code")).toEqual({ email: "person@example.com", restartNeeded: true });
    } finally {
      started.stop();
      google.stop();
    }
  });

  test("a log out deletes the saved login and clears the account", async () => {
    const google = fakeGoogle();
    google.grantedScope = googleScopes(defaultConfig.google).join(" ");
    const withGoogle = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, google: { ...defaultConfig.google, email: "person@example.com" } },
      secrets: {
        googleOauthClientId: "123456789012-clientid.apps.googleusercontent.com",
        googleOauthClientSecret: "GOCSPX-client-secret-value",
      },
      engines: [engine],
      runner: uvRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      googleBaseUrl: google.url,
    });
    try {
      withGoogle.startGoogleLogin();
      await withGoogle.finishGoogleLogin("the-code");
      const folder = googleCredentialsFolder(homePaths(home));
      expect(readGoogleCredential(folder, "person@example.com")).not.toBeNull();
      // Chats got the account at start, so they keep it until a restart.
      expect(await withGoogle.logOutOfGoogle()).toEqual({ restartNeeded: true });
      expect(readGoogleCredential(folder, "person@example.com")).toBeNull();
      expect(loadSettings(homePaths(home)).config.google.email).toBeNull();
      // A second log out finds nothing to delete, and still works.
      expect(await withGoogle.logOutOfGoogle()).toEqual({ restartNeeded: true });
    } finally {
      withGoogle.stop();
      google.stop();
    }
  });

  test("the login waits for an OAuth client", () => {
    expect(() => eva.startGoogleLogin()).toThrow("step 3");
  });
});

describe("the Claude Code login from the page", () => {
  const address = "https://claude.com/cai/oauth/authorize?code=true&state=example-state";
  const token = `sk-ant-oat01-${"x".repeat(80)}`;

  test("runs claude setup-token in this Eva's Claude folder, and saves the token", async () => {
    const started: { command: readonly string[]; environment: Readonly<Record<string, string>> }[] = [];
    const withClaude = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: { claudeOauthToken: "sk-ant-oat01-old-token-value" },
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      claudeExecutable: "/opt/example/claude",
      startTerminal: (command, options) => {
        started.push({ command, environment: options.environment });
        let output = `${address}\r\nPaste code here if prompted >`;
        const listeners: (() => void)[] = [];
        return {
          output: () => output,
          received: () => output.length,
          onOutput: (listener) => {
            listeners.push(listener);
            return () => undefined;
          },
          write: () => {
            output += `\r\n${token}\r\n`;
            for (const listener of listeners) listener();
          },
          exited: new Promise<number>(() => undefined),
          stop: () => undefined,
        };
      },
    });
    try {
      expect(await withClaude.startClaudeLogin()).toEqual({ url: address });
      expect(started[0]?.command).toEqual(["/opt/example/claude", "setup-token"]);
      expect(started[0]?.environment["CLAUDE_CONFIG_DIR"]).toBe(join(home, "engines", "claude"));
      // The old token must not log claude in: the new login may be another account.
      expect(started[0]?.environment["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
      expect(await withClaude.finishClaudeLogin("example-code#example-state")).toEqual({ restartNeeded: true });
      expect(loadSecrets(homePaths(home)).claudeOauthToken).toBe(token);
    } finally {
      withClaude.stop();
    }
  });

  test("says so when this machine has no claude program", async () => {
    const error = await eva.startClaudeLogin().catch((caught: unknown) => caught);
    expect(String(error)).toContain("did not find the claude program");
  });
});

describe("the GitHub login from the page", () => {
  test("shows the code, then saves the token as a pasted one, with the account", async () => {
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        request.headers.get("authorization") === "Bearer gho_page_login"
          ? Response.json({ login: "example-user", name: "Example User", id: 7 })
          : Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    const gh = fakeGh(systemProcessRunner);
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: gh,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
      githubBrowserLogin: (show) => {
        show("ABCD-1234", "https://github.com/login/device");
        return Promise.resolve("gho_page_login");
      },
    });
    const githubStep = async (): Promise<string | undefined> =>
      (await instance.setupState()).progress.find((step) => step.key === "github")?.state;
    try {
      expect(await instance.startGitHubLogin()).toEqual({ code: "ABCD-1234", url: "https://github.com/login/device" });
      expect(await instance.finishGitHubLogin()).toEqual({ restartNeeded: true });
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_page_login");
      // One login: the agents' gh gets the same token, on stdin (#244). The version read comes first.
      expect(gh.calls.map((call) => call.command.slice(0, 3))).toEqual([
        ["gh", "--version"],
        ["gh", "auth", "login"],
      ]);
      expect(gh.calls[1]?.stdin).toBe("gho_page_login\n");
      expect(await githubStep()).toBe("done");
      // Removing the token logs the agents out too, with no gh process: gh's logout reaches the keyring.
      await instance.saveSecret("githubToken", null);
      expect(gh.calls).toHaveLength(2);
      expect(readFileSync(join(home, "engines", "gh", "hosts.yml"), "utf8")).not.toContain("github.com");
      expect(await githubStep()).toBe("optional");
    } finally {
      instance.stop();
      await github.stop(true);
    }
  });

  // A phone cannot install gh: Log in must fix a missing or old gh on its own.
  test("a machine with no gh, or an old one, gets the latest gh before the login", async () => {
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ login: "example-user", id: 7 }),
    });
    const release = serveGhRelease();
    try {
      for (const version of [null, "2.4.0"]) {
        const gh = fakeGh(systemProcessRunner);
        const runner = ghInstallRunner(gh, { version });
        const instance = new Eva({
          paths: homePaths(home),
          config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
          secrets: {},
          engines: [engine],
          runner,
          processEnvironment: gitEnvironment,
          now: () => new Date(),
          basePrompt: "Base.",
          githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
          toolPlaces: { platform: "linux", userHome: home, standalone: false },
          toolInstall: { arch: "x64", ghReleaseUrl: release.url },
        });
        try {
          await instance.saveSecret("githubToken", "gho_fresh_machine");
          expect(runner.installs).toBe(1);
          expect(gh.calls.map((call) => call.command.slice(0, 3))).toContainEqual(["gh", "auth", "login"]);
          expect(await instance.runCheck("github")).toMatchObject({ ok: true });
        } finally {
          instance.stop();
        }
      }
    } finally {
      await release.stop();
      await github.stop(true);
    }
  });

  test("a failed gh install skips the login, and the log says why", async () => {
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ login: "example-user", id: 7 }),
    });
    const gh = fakeGh(systemProcessRunner);
    const warnings: string[] = [];
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: ghInstallRunner(gh, { version: null }),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
      toolPlaces: { platform: "linux", userHome: home, standalone: false },
      toolInstall: { arch: "x64", ghReleaseUrl: "http://127.0.0.1:1/latest" },
      logger: {
        log: (level, message) => {
          if (level === "warn") warnings.push(message);
        },
      },
    });
    try {
      await instance.saveSecret("githubToken", "gho_offline_machine");
      expect(gh.calls.filter((call) => call.command[1] === "auth")).toEqual([]);
      expect(warnings.join("\n")).toContain("Eva could not install gh");
    } finally {
      instance.stop();
      await github.stop(true);
    }
  });

  test("a removal during a slow save leaves the agents' gh logged out", async () => {
    // GitHub answers the account read late, so the save's gh login would come after the removal.
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () => {
        await Bun.sleep(300);
        return Response.json({ login: "example-user", id: 7 });
      },
    });
    const gh = fakeGh(systemProcessRunner);
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: gh,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      githubApiBaseUrl: `http://127.0.0.1:${String(github.port)}`,
    });
    try {
      await Promise.all([instance.saveSecret("githubToken", "gho_slow"), instance.saveSecret("githubToken", null)]);
      expect(loadSecrets(homePaths(home)).githubToken).toBeUndefined();
      expect(gh.calls.filter((call) => call.command[2] === "login")).toEqual([]);
      expect((await instance.setupState()).progress.find((step) => step.key === "github")?.state).toBe("optional");
    } finally {
      instance.stop();
      await github.stop(true);
    }
  });

  test("a token that gh refuses is still saved, and the step says what to do", async () => {
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: fakeGh(systemProcessRunner, "error validating token: missing required scope 'read:org'"),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      // Nothing listens here: the account read fails at once, and the save goes on.
      githubApiBaseUrl: "http://127.0.0.1:9",
    });
    try {
      expect(await instance.saveSecret("githubToken", "gho_old_scopes")).toEqual({ saved: true, restartNeeded: true });
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_old_scopes");
      const github = (await instance.setupState()).progress.find((step) => step.key === "github");
      expect(github?.state).toBe("missing");
      expect(github?.detail).toContain("Log in with GitHub");
    } finally {
      instance.stop();
    }
  });

  test("with no OAuth App, the error says to paste a token", async () => {
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      githubBrowserLogin: null,
    });
    try {
      const error = await instance.startGitHubLogin().catch((caught: unknown) => caught);
      expect(String(error)).toContain("Paste a token");
    } finally {
      instance.stop();
    }
  });
});

describe("the vault step on the page", () => {
  const withoutVault = (githubApiBaseUrl?: string): Eva =>
    new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, timeZone: "UTC" },
      secrets: {},
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      ...(githubApiBaseUrl === undefined ? {} : { githubApiBaseUrl }),
    });
  const vaultStep = async (instance: Eva): Promise<string | undefined> =>
    (await instance.setupState()).progress.find((step) => step.key === "vault")?.state;

  test("a token saved on the page lists the repositories, and a clone shows the step as done", async () => {
    const github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        request.headers.get("authorization") === "Bearer a-page-token"
          ? Response.json([{ full_name: "you/vault", clone_url: sandbox.remote, private: true }])
          : Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    const instance = withoutVault(`http://127.0.0.1:${String(github.port)}`);
    try {
      expect(await vaultStep(instance)).toBe("missing");
      await instance.saveSecret("githubToken", "a-page-token");
      const [repository] = await instance.vaultRepositories();
      expect(repository?.fullName).toBe("you/vault");
      const result = await instance.cloneVault(repository?.cloneUrl ?? "");
      expect(result.folder).toBe(join(home, "vault"));
      expect(existsSync(join(home, "vault", "AGENTS.md"))).toBe(true);
      const state = await instance.setupState();
      expect(state.progress.find((step) => step.key === "vault")?.state).toBe("done");
      // The running Eva keeps the vault of her start.
      expect(state.restartNeeded).toBe(true);
      expect(state.vaultNeedsPush).toBe(false);
    } finally {
      instance.stop();
      await github.stop(true);
    }
  });

  test("a failed push of a new vault never sends a token back to the page", async () => {
    const instance = withoutVault();
    try {
      const token = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const result = await instance.createVault({
        name: "Sam",
        language: "English",
        topics: [],
        repository: `https://x-access-token:${token}@127.0.0.1:1/you/vault.git`,
      });
      expect(result.repository).toBeNull();
      expect(result.problem).toContain("could not push");
      expect(JSON.stringify(result)).not.toContain(token);
      // A password of another service has no known shape, so the login part of the address goes.
      // A failed push of the local vault throws, and its error goes to the page too.
      const refused = await instance
        .pushVault("https://person:plain-password@127.0.0.1:1/you/vault.git")
        .catch((error: unknown) => error);
      expect(isEvaError(refused, "github_failed")).toBe(true);
      expect(String(refused)).not.toContain("plain-password");
    } finally {
      instance.stop();
    }
  });

  test("an empty saved folder shows the step as missing, and a new local vault asks for its push", async () => {
    const instance = withoutVault();
    try {
      mkdirSync(join(home, "notes"));
      writeFileSync(homePaths(home).config, JSON.stringify({ vaultPath: join(home, "notes") }));
      expect(await vaultStep(instance)).toBe("missing");
      const result = await instance.createVault({ name: "Sam", language: "English", topics: [], repository: "" });
      expect(result).toMatchObject({ folder: join(home, "notes"), repository: null });
      expect(await vaultStep(instance)).toBe("done");
      expect((await instance.setupState()).vaultNeedsPush).toBe(true);
      const bare = join(sandbox.root, "empty.git");
      mkdirSync(bare);
      sandbox.git(bare, "init", "-q", "--bare");
      expect((await instance.pushVault(bare)).repository).toBe(bare);
      expect((await instance.setupState()).vaultNeedsPush).toBe(false);
    } finally {
      instance.stop();
    }
  });
});

describe("the commit identity of an Eva", () => {
  const account = { id: 1234, login: "example-user", name: "Example User" };
  const email = "1234+example-user@users.noreply.github.com";
  let github: ReturnType<typeof Bun.serve> | null = null;
  afterEach(async () => {
    await github?.stop(true);
    github = null;
  });
  /** A fake GitHub API that answers `GET /user` for one token. */
  const fakeAccountApi = (): string => {
    github = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        request.headers.get("authorization") === "Bearer a-page-token"
          ? Response.json(account)
          : Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    return `http://127.0.0.1:${String(github.port)}`;
  };
  const instanceWith = (secrets: Record<string, string>, githubApiBaseUrl?: string): Eva =>
    new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, timeZone: "UTC" },
      secrets,
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      ...(githubApiBaseUrl === undefined ? {} : { githubApiBaseUrl }),
    });
  const agentGitConfig = (): string => readFileSync(join(home, "engines", "git", "gitconfig"), "utf8");

  test("a token from before Eva kept the account shows as a login whose account is not read yet", () => {
    const instance = instanceWith({ githubToken: "an-old-token" });
    try {
      expect(instance.trust()).toMatchObject({ githubAccount: null, githubLoggedIn: true });
    } finally {
      instance.stop();
    }
  });

  test("a start signs the agents' commits with the saved account", () => {
    saveGitHubAccount(homePaths(home), account);
    const instance = instanceWith({});
    try {
      expect(agentGitConfig()).toContain('name = "Example User"');
      expect(agentGitConfig()).toContain(`email = "${email}"`);
    } finally {
      instance.stop();
    }
  });

  test("the name and email that the person sets win over the account", () => {
    saveGitHubAccount(homePaths(home), account);
    const instance = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, timeZone: "UTC", git: { name: "Another Name", email: "another@example.com" } },
      secrets: {},
      engines: [engine],
      runner: fakeGh(systemProcessRunner),
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
    });
    try {
      expect(agentGitConfig()).toContain('name = "Another Name"');
      expect(agentGitConfig()).toContain('email = "another@example.com"');
    } finally {
      instance.stop();
    }
  });

  test("a token saved on the page reads its account, and a removed token removes it", async () => {
    const instance = instanceWith({}, fakeAccountApi());
    try {
      await instance.saveSecret("githubToken", "a-page-token");
      expect(loadGitHubAccount(homePaths(home))).toEqual(account);
      await instance.saveSecret("githubToken", null);
      expect(loadGitHubAccount(homePaths(home))).toBeNull();
    } finally {
      instance.stop();
    }
  });

  test("a vault made on the page right after a token save carries the new account's name", async () => {
    const instance = instanceWith({}, fakeAccountApi());
    try {
      await instance.saveSecret("githubToken", "a-page-token");
      mkdirSync(join(home, "notes"));
      writeFileSync(homePaths(home).config, JSON.stringify({ vaultPath: join(home, "notes") }));
      await instance.createVault({ name: "Sam", language: "English", topics: [], repository: "" });
      expect(sandbox.git(join(home, "notes"), "log", "-1", "--format=%an <%ae>")).toBe(`Example User <${email}>`);
    } finally {
      instance.stop();
    }
  });

  test("the GitHub check of an older install fills a missing account", async () => {
    const instance = instanceWith({ githubToken: "a-page-token" }, fakeAccountApi());
    try {
      // An older install has no gh login for the agents, so the Test fails, but the token is good.
      expect((await instance.runCheck("github")).detail).toContain("your agents cannot push their work yet");
      expect(loadGitHubAccount(homePaths(home))).toEqual(account);
    } finally {
      instance.stop();
    }
  });
});
