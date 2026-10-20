import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { Eva, type EvaStatus } from "../../../../src/core/eva.ts";
import { loadGitHubAccount, saveGitHubAccount } from "../../../../src/core/instance/commit-identity.ts";
import { defaultConfig, homePaths, loadSecrets, saveSecrets } from "../../../../src/core/settings/home.ts";
import { changeSettings, loadSettings } from "../../../../src/core/settings/settings.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { parseArguments } from "../../../../src/frontends/cli/arguments.ts";
import { runChat } from "../../../../src/frontends/cli/chat.ts";
import {
  describeLogEntries,
  describeProjects,
  describeRemoteAccess,
  describeRole,
  describeStatus,
  describeEngineUpdate,
  describeStatusLines,
  describeToolVersions,
  describeSync,
  describeRelease,
  describeUpdate,
  describeUpdateWithHint,
  majorUpdateWarning,
  requestHub,
  requestStatus,
  requestSettingsChange,
  requestSync,
  requestUpdate,
  heldBackLines,
  startProjectWork,
} from "../../../../src/frontends/cli/client.ts";
import { runDoctor, type DoctorOptions } from "../../../../src/frontends/cli/doctor.ts";
import {
  restartMethod,
  serviceName,
  servicePath,
  systemdUnit,
  windowsRunTaskCommand,
  windowsTaskSettingsCommand,
  windowsTaskCommand,
} from "../../../../src/frontends/cli/service.ts";
import type { UpdateStatus } from "../../../../src/core/updates/updater.ts";
import {
  firstFreePort,
  runSetup,
  setupEnvironmentNames,
  type SetupOptions,
  type SetupQuestion,
} from "../../../../src/frontends/cli/setup.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner, type ProcessResult, type ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";
import { scriptedRunner } from "../../../support/fake-host.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

describe("parseArguments", () => {
  test("no command runs the core", () => {
    expect(parseArguments([])).toEqual({ command: "run", instance: undefined });
  });

  test("reads --instance anywhere, and the options of each command", () => {
    expect(parseArguments(["--instance", "ana", "status"])).toEqual({ command: "status", instance: "ana" });
    expect(
      parseArguments([
        "chat",
        "--project",
        "2025-03-02-1015-example-app",
        "--clone",
        "example-app-0",
        "--model",
        "haiku",
      ]),
    ).toEqual({
      command: "chat",
      instance: undefined,
      projectId: "2025-03-02-1015-example-app",
      clone: "example-app-0",
      model: "haiku",
    });
    expect(parseArguments(["projects", "photo", "booth"])).toEqual({
      command: "projects",
      instance: undefined,
      query: "photo booth",
    });
    expect(parseArguments(["service", "install"])).toEqual({ command: "service-install", instance: undefined });
    expect(parseArguments(["supervise", "--instance", "ana"])).toEqual({ command: "supervise", instance: "ana" });
    expect(parseArguments(["setup"])).toEqual({ command: "setup", instance: undefined, nonInteractive: false });
    expect(parseArguments(["setup", "--non-interactive", "--instance", "ana"])).toEqual({
      command: "setup",
      instance: "ana",
      nonInteractive: true,
    });
    expect(parseArguments(["doctor"])).toEqual({ command: "doctor", instance: undefined });
    expect(parseArguments(["work", "2025-03-02-1015-example-app", "fix", "the", "bug"])).toEqual({
      command: "work",
      instance: undefined,
      projectId: "2025-03-02-1015-example-app",
      request: "fix the bug",
    });
    expect(parseArguments(["work", "only-a-project"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["chat", "--engine", "pi"])).toEqual({ command: "chat", instance: undefined, engine: "pi" });
    expect(parseArguments(["chat", "--engine", "codex"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["update"])).toEqual({
      command: "update",
      instance: undefined,
      checkOnly: false,
      version: null,
    });
    expect(parseArguments(["update", "--check"])).toEqual({
      command: "update",
      instance: undefined,
      checkOnly: true,
      version: null,
    });
    expect(parseArguments(["update", "1.2.0"])).toEqual({
      command: "update",
      instance: undefined,
      checkOnly: false,
      version: "1.2.0",
    });
    expect(parseArguments(["update", "v1.2.0"])).toMatchObject({ version: "1.2.0" });
    expect(parseArguments(["update", "latest"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["sync"])).toEqual({ command: "sync", instance: undefined });
    expect(parseArguments(["hub"])).toEqual({ command: "hub", instance: undefined });
    expect(parseArguments(["link"])).toEqual({ command: "link", instance: undefined });
    expect(parseArguments(["devices", "allow", "AB2C"])).toEqual({
      command: "devices-allow",
      instance: undefined,
      code: "AB2C",
    });
    expect(parseArguments(["devices", "allow"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["devices"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["settings"])).toEqual({ command: "settings", instance: undefined, action: "list" });
    expect(parseArguments(["settings", "get", "updates.frequency"])).toEqual({
      command: "settings",
      instance: undefined,
      action: "get",
      key: "updates.frequency",
    });
    expect(parseArguments(["settings", "set", "timeZone", "Europe/Madrid"])).toEqual({
      command: "settings",
      instance: undefined,
      action: "set",
      key: "timeZone",
      value: "Europe/Madrid",
    });
    expect(parseArguments(["settings", "set", "timeZone"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["settings", "remove", "x"])).toMatchObject({ command: "usage-error" });
  });

  test("an unknown command or a bad option is a usage error", () => {
    expect(parseArguments(["fly"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["chat", "--model", "giant"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["--instance"])).toMatchObject({ command: "usage-error" });
    // An option that Eva does not know is never dropped without a word, such as the old --home.
    expect(parseArguments(["--home", "/h", "status"])).toMatchObject({
      command: "usage-error",
      message: "Unknown option --home.",
    });
    expect(parseArguments(["help"])).toEqual({ command: "help", instance: undefined });
  });
});

describe("runDoctor", () => {
  const doctorBasics = {
    standalone: false,
    platform: "win32",
    userName: "person",
    userHome: "/srv/person",
    defaultEngine: "claude-code",
    google: () => Promise.resolve(null),
  } as const satisfies Partial<DoctorOptions>;

  test("reports the Google state, which never fails the doctor", async () => {
    const runner: ProcessRunner = {
      run: () => Promise.resolve({ exitCode: 0, stdout: "1.0\n", stderr: "" }),
    };
    const report = async (google: DoctorOptions["google"]): Promise<{ healthy: boolean; text: string }> => {
      const lines: string[] = [];
      const healthy = await runDoctor({
        ...doctorBasics,
        runner,
        environment: {},
        write: (line) => lines.push(line),
        google,
      });
      return { healthy, text: lines.join("\n") };
    };
    expect((await report(() => Promise.resolve(null))).text).toContain("off     Google: not set up.");
    const works = await report(() =>
      Promise.resolve({ ok: true, detail: "The Google login of person@example.com works." }),
    );
    expect(works.text).toContain("ok      Google: The Google login of person@example.com works.");
    const broken = await report(() => Promise.resolve({ ok: false, detail: "Log in to Google again (step 4)." }));
    expect(broken).toEqual({
      healthy: true,
      text: expect.stringContaining("failed  Google: Log in to Google again (step 4).") as string,
    });
  });

  test("reports each tool, grouped by feature, and fails only on a missing required tool", async () => {
    const runner: ProcessRunner = {
      run: (command) => {
        const program = command[0] ?? "";
        const found: Record<string, string> = {
          git: "git version 2.50.0",
          bun: "1.4.2",
          claude: "2.1.286 (Claude Code)",
        };
        const result: ProcessResult =
          program in found
            ? { exitCode: 0, stdout: `${found[program] ?? ""}\n`, stderr: "" }
            : { exitCode: 1, stdout: "", stderr: "not found" };
        return program in found ? Promise.resolve(result) : Promise.reject(new Error("not found"));
      },
    };
    const lines: string[] = [];
    const healthy = await runDoctor({
      ...doctorBasics,
      runner,
      environment: { PATH: "/bin" },
      write: (line) => lines.push(line),
    });
    expect(healthy).toBe(true);
    expect(lines.join("\n")).toContain("ok      git: git version 2.50.0");
    expect(lines.join("\n")).toContain("missing gh");
    expect(lines.join("\n")).toContain("Optional:");
    // Each tool shows how to update it (lesson 94).
    expect(lines.join("\n")).toContain("ok      claude: 2.1.286 (Claude Code) (update: claude update)");
  });

  test("a missing required tool fails the check", async () => {
    const runner: ProcessRunner = { run: () => Promise.reject(new Error("not found")) };
    expect(await runDoctor({ ...doctorBasics, runner, environment: {}, write: () => undefined })).toBe(false);
  });

  test("the single executable carries its own Bun, so bun is not checked", async () => {
    const asked: string[] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        asked.push(command[0] ?? "");
        return Promise.resolve({ exitCode: 0, stdout: "v1\n", stderr: "" });
      },
    };
    expect(
      await runDoctor({ ...doctorBasics, runner, environment: {}, write: () => undefined, standalone: true }),
    ).toBe(true);
    expect(asked).not.toContain("bun");
    expect(asked).toContain("git");
  });

  /** On Windows, cmd runs pi, so the program is the fourth word. */
  function finding(programs: readonly string[]): ProcessRunner {
    return {
      run: (command) =>
        programs.includes((command[0] === "cmd" ? command[3] : command[0]) ?? "")
          ? Promise.resolve({ exitCode: 0, stdout: "v1\n", stderr: "" })
          : Promise.reject(new Error("not found")),
    };
  }

  test("the default engine's program is required, and setup installs it", async () => {
    const lines: string[] = [];
    const runner = finding(["git", "bun"]);
    const write = (line: string): number => lines.push(line);
    expect(await runDoctor({ ...doctorBasics, runner, environment: {}, write, platform: "linux" })).toBe(false);
    expect(lines.join("\n")).toContain("missing claude (for the Claude Code engine): run `eva setup`");
    // Eva installs Tailscale herself, with no root.
    expect(lines.join("\n")).toContain(
      "missing tailscale (for opening Eva on your phone and other computers): run `eva setup`",
    );
    expect(lines.indexOf("Optional:")).toBeGreaterThan(lines.findIndex((line) => line.includes("missing claude")));
    expect(await runDoctor({ ...doctorBasics, runner, environment: {}, write, defaultEngine: "pi" })).toBe(false);
    const withPi = finding(["git", "bun", "pi"]);
    expect(await runDoctor({ ...doctorBasics, runner: withPi, environment: {}, write, defaultEngine: "pi" })).toBe(
      true,
    );
  });

  test("finds an engine in its installer's folder when the PATH lacks it", async () => {
    const lines: string[] = [];
    const runner = finding(["git", "bun", "/srv/person/.local/bin/claude"]);
    const write = (line: string): number => lines.push(line);
    expect(await runDoctor({ ...doctorBasics, runner, environment: {}, write, platform: "linux" })).toBe(true);
    expect(lines.join("\n")).toContain("ok      claude: v1");
  });

  test("on Linux, it reports whether the user's services run while the user is logged out", async () => {
    const asked: string[][] = [];
    const linger = (answer: string): ProcessRunner => ({
      run: (command) => {
        asked.push([...command]);
        return Promise.resolve({
          exitCode: 0,
          stdout: command[0] === "loginctl" ? `Linger=${answer}\n` : "v1\n",
          stderr: "",
        });
      },
    });
    const lines: string[] = [];
    const options = {
      ...doctorBasics,
      environment: {},
      write: (line: string) => lines.push(line),
      platform: "linux" as const,
    };
    expect(await runDoctor({ ...options, runner: linger("yes") })).toBe(true);
    expect(asked).toContainEqual(["loginctl", "show-user", "person", "--property=Linger"]);
    expect(lines.join("\n")).toContain("ok      linger");
    lines.length = 0;
    expect(await runDoctor({ ...options, runner: linger("no") })).toBe(true);
    expect(lines.join("\n")).toContain("loginctl enable-linger");
    asked.length = 0;
    await runDoctor({ ...doctorBasics, runner: linger("yes"), environment: {}, write: () => undefined });
    expect(asked.some((command) => command[0] === "loginctl")).toBe(false);
  });
});

describe("runSetup", () => {
  let root: string;
  let home: string;
  let existingVault: string;
  beforeEach(() => {
    // The home sits in a folder of its own, as eva-<name>, so its siblings are only this test's other Evas.
    root = mkdtempSync(join(tmpdir(), "eva-setup-"));
    home = join(root, "eva-test");
    mkdirSync(home);
    existingVault = join(home, "existing-vault");
    mkdirSync(existingVault);
    writeFileSync(join(existingVault, "AGENTS.md"), "# Vault\n");
  }, gitHookTimeoutMs);
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  }, gitHookTimeoutMs);

  /**
   * A fake GitHub API for every setup test, so none reaches github.com. The list holds no
   * repository unless a test says so. A created repository's address is a local bare repository.
   */
  const githubApi: {
    server: ReturnType<typeof Bun.serve> | null;
    list: { status: number; body: unknown };
    user: { status: number; body: unknown };
    create: (name: string) => { status: number; body: unknown };
    created: string[];
  } = {
    server: null,
    list: { status: 200, body: [] },
    user: { status: 200, body: {} },
    create: () => ({ status: 500, body: {} }),
    created: [],
  };
  beforeAll(() => {
    githubApi.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        if (request.method === "GET" && new URL(request.url).pathname === "/user")
          return Response.json(githubApi.user.body, { status: githubApi.user.status });
        if (request.method === "GET") return Response.json(githubApi.list.body, { status: githubApi.list.status });
        const { name } = (await request.json()) as { name: string };
        githubApi.created.push(name);
        const reply = githubApi.create(name);
        return Response.json(reply.body, { status: reply.status });
      },
    });
  });
  afterAll(async () => {
    await githubApi.server?.stop(true);
  });
  beforeEach(() => {
    githubApi.list = { status: 200, body: [] };
    githubApi.user = { status: 200, body: { id: 1234, login: "example-user", name: "Example User" } };
    githubApi.create = () => ({ status: 500, body: { message: "No create in this test." } });
    githubApi.created = [];
  });
  /** A local bare repository that stands for a new, empty GitHub repository. */
  function emptyRepository(name: string): string {
    const bare = join(home, `${name}.git`);
    mkdirSync(bare);
    Bun.spawnSync(["git", "init", "-q", "--bare", "--initial-branch=main"], { cwd: bare, env: gitEnvironment });
    return bare;
  }

  const okRunner: ProcessRunner = { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) };
  /** Real git; every other program, such as an engine or its installer, answers at once and installs nothing. */
  const gitRunner: ProcessRunner = {
    run: (command, options) =>
      command[0] === "git" ? systemProcessRunner.run(command, options) : okRunner.run(command, options),
  };

  async function setup(
    answers: Partial<Record<SetupQuestion, string | string[]>>,
    extra: {
      interactive?: boolean;
      runner?: ProcessRunner;
      lines?: string[];
      asked?: SetupQuestion[];
      githubLogin?: SetupOptions["githubLogin"];
      piReleasesBaseUrl?: string;
    } = {},
  ): Promise<void> {
    const queues = Object.fromEntries(
      Object.entries(answers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]),
    ) as Partial<Record<SetupQuestion, string[]>>;
    await runSetup({
      paths: homePaths(home),
      ask: (key) => {
        extra.asked?.push(key);
        return Promise.resolve(queues[key]?.shift() ?? "");
      },
      write: (line) => extra.lines?.push(line),
      newToken: () => "generated-token",
      interactive: extra.interactive ?? true,
      runner: extra.runner ?? okRunner,
      environment: gitEnvironment,
      githubLogin: extra.githubLogin ?? null,
      githubApiBaseUrl: `http://127.0.0.1:${String(githubApi.server?.port)}`,
      platform: "linux",
      userHome: home,
      installEnvironment: gitEnvironment,
      arch: "x64",
      ...(extra.piReleasesBaseUrl === undefined ? {} : { piReleasesBaseUrl: extra.piReleasesBaseUrl }),
    });
  }

  test("writes the answers to the config and the secrets, and creates the local API token", async () => {
    await setup(
      { vault: existingVault, timeZone: "Europe/Madrid", port: "7421", trustedOwners: "owner, other" },
      { interactive: false },
    );
    expect(loadSettings(homePaths(home)).config).toMatchObject({
      vaultPath: existingVault,
      timeZone: "Europe/Madrid",
      port: 7421,
      trust: { trustedRepositoryOwners: ["owner", "other"] },
    });
    expect(loadSecrets(homePaths(home))).toEqual({ localApiToken: "generated-token" });
  });

  test("an empty answer keeps the current value, and a Claude token is stored as a secret", async () => {
    await setup({ claudeToken: "a-claude-setup-token-value" });
    expect(loadSettings(homePaths(home)).config.port).toBe(defaultConfig.port);
    expect(loadSecrets(homePaths(home)).claudeOauthToken).toBe("a-claude-setup-token-value");
  });

  test("a vault that a newer Eva migrated can refuse the settings, but the typed tokens stay saved (#119)", async () => {
    mkdirSync(join(existingVault, ".eva"));
    writeFileSync(
      join(existingVault, ".eva", "migrations.json"),
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
    let caught: unknown = null;
    try {
      await setup(
        { vault: existingVault, timeZone: "Europe/Madrid", telegramToken: "123456:telegram-token-value" },
        { interactive: false },
      );
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "vault_ahead")).toBe(true);
    expect(loadSecrets(homePaths(home)).telegramBotToken).toBe("123456:telegram-token-value");
  });

  test("a Telegram token is stored as a secret", async () => {
    await setup({ telegramToken: "123456:telegram-token-value" });
    expect(loadSecrets(homePaths(home)).telegramBotToken).toBe("123456:telegram-token-value");
  });

  test("Google and voice answers reach the config and the secrets", async () => {
    await setup({
      googleEmail: "person@example.com",
      googleClientId: "client-id",
      googleClientSecret: "client-secret",
      voiceModel: "/models/ggml-base.bin",
    });
    const config = loadSettings(homePaths(home)).config;
    expect(config.google.email).toBe("person@example.com");
    expect(config.voice.modelPath).toBe("/models/ggml-base.bin");
    const again: string[] = [];
    await setup({}, { lines: again });
    expect(again.join("\n")).not.toContain("each Google step");
    expect(loadSecrets(homePaths(home))).toMatchObject({
      googleOauthClientId: "client-id",
      googleOauthClientSecret: "client-secret",
    });
  });

  test("without a Google account, the OAuth client is not asked", async () => {
    const lines: string[] = [];
    await setup({ googleClientId: "client-id" }, { lines });
    expect(lines.join("\n")).toContain("Settings in the web app show each Google step");
    expect(loadSecrets(homePaths(home)).googleOauthClientId).toBeUndefined();
  });

  test("setup asks no default engine; a script still sets it, and a wrong one stops the script", async () => {
    const asked: SetupQuestion[] = [];
    await setup({ engine: "pi" }, { asked });
    expect(asked).not.toContain("engine");
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("claude-code");
    await setup({ engine: "pi" }, { interactive: false });
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("pi");
    let caught: unknown;
    try {
      await setup({ engine: "codex" }, { interactive: false });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
  });

  test("the default engine follows the login, and Claude Code stays when both have one", async () => {
    const piLogin = (): void => {
      mkdirSync(join(home, "engines", "pi-agent"), { recursive: true });
      writeFileSync(join(home, "engines", "pi-agent", "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
    };
    const lines: string[] = [];
    piLogin();
    await setup({}, { lines });
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("pi");
    expect(lines.join("\n")).toContain("Eva uses pi");
    // A Claude token now: the person chose nothing on the web page, but pi stays, as the default has a login.
    await setup({ claudeToken: "a-claude-setup-token-value" });
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("pi");
    rmSync(join(home, "engines", "pi-agent"), { recursive: true });
    await setup({});
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("claude-code");
    // The instance's own Claude Code login counts as much as a token.
    rmSync(join(home, "secrets.json"));
    mkdirSync(join(home, "engines", "claude"), { recursive: true });
    writeFileSync(join(home, "engines", "claude", ".credentials.json"), "{}");
    piLogin();
    await setup({});
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("claude-code");
  });

  describe("the harness install (#136)", () => {
    const archive = new TextEncoder().encode("a pretend pi archive");
    let server: ReturnType<typeof Bun.serve> | null = null;
    afterEach(() => {
      void server?.stop(true);
      server = null;
    });

    /** A fake pi release; `broken` serves no files. */
    function serveRelease(broken = false): string {
      const hash = createHash("sha256").update(archive).digest("hex");
      void server?.stop(true);
      server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
          const path = new URL(request.url).pathname;
          if (broken) return new Response("not found", { status: 404 });
          if (path === "/SHA256SUMS") return new Response(`${hash}  pi-linux-x64.tar.gz\n`);
          return path === "/pi-linux-x64.tar.gz" ? new Response(archive) : new Response("", { status: 404 });
        },
      });
      return `http://127.0.0.1:${String(server.port)}`;
    }

    /** No engine answers until its install ran; `failClaude` makes the Claude Code installer fail. */
    const installRunner = (commands: string[][], failClaude = false): ProcessRunner => {
      let claude = false;
      return {
        run: (command) => {
          commands.push([...command]);
          const program = command[0] ?? "";
          if (program === "bash") {
            if (failClaude) return Promise.resolve({ exitCode: 1, stdout: "", stderr: "the installer broke\n" });
            claude = true;
          } else if (program === "tar") {
            writeFileSync(join(command[command.indexOf("-C") + 1] ?? "", "pi"), "pretend program");
          } else if (command.at(-1) === "--version") {
            const found = program.endsWith("claude") ? claude && program === "claude" : existsSync(program);
            if (!found) return Promise.reject(new EvaError("process_failed", "Could not start it."));
          }
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        },
      };
    };

    test("with neither harness, setup installs both with no question, before the token question", async () => {
      const commands: string[][] = [];
      const lines: string[] = [];
      const asked: SetupQuestion[] = [];
      await setup({}, { runner: installRunner(commands), lines, asked, piReleasesBaseUrl: serveRelease() });
      expect(commands).toContainEqual(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
      expect(commands.some((command) => command[0] === "tar")).toBe(true);
      expect(existsSync(join(home, ".local", "lib", "pi", "pi"))).toBe(true);
      expect(asked).not.toContain("engine");
      const text = lines.join("\n");
      expect(text).toContain("Installed Claude Code: claude.");
      // Setup runs as Linux here, so the path has forward slashes on every machine.
      expect(text).toContain(`Installed pi: ${posix.join(home, ".local", "lib", "pi", "pi")}.`);
      expect(text).toContain("and type /login");
      expect(text).toContain("run `claude setup-token`");
    });

    test("with no uv, setup installs it after the harnesses, for the Google tools", async () => {
      const commands: string[][] = [];
      const lines: string[] = [];
      await setup({}, { runner: installRunner(commands), lines, piReleasesBaseUrl: serveRelease() });
      expect(commands).toContainEqual(["sh", "-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]);
      expect(lines.join("\n")).toContain("Installing uv");
    });

    test("a script can skip the installs; a person is never asked", async () => {
      const commands: string[][] = [];
      const asked: SetupQuestion[] = [];
      await setup({ installEngines: "no" }, { interactive: false, runner: installRunner(commands), asked });
      expect(commands.some((command) => ["bash", "tar", "sh"].includes(command[0] ?? ""))).toBe(false);
      asked.length = 0;
      await setup({}, { runner: scriptedRunner([]), asked });
      expect(asked).not.toContain("installEngines");
    });

    test("a failed Claude Code install does not stop the pi install", async () => {
      const lines: string[] = [];
      await setup({}, { runner: installRunner([], true), lines, piReleasesBaseUrl: serveRelease() });
      const text = lines.join("\n");
      expect(text).toContain("bash failed: the installer broke. Run `curl");
      expect(text).toContain("Setup goes on without it.");
      expect(text).toContain("Installed pi:");
    });

    test("each instance logs in to pi in its own folder", async () => {
      const lines: string[] = [];
      await setup(
        {},
        {
          runner: installRunner([]),
          lines,
          piReleasesBaseUrl: serveRelease(),
        },
      );
      expect(lines.join("\n")).toContain(`PI_CODING_AGENT_DIR='${join(home, "engines", "pi-agent")}' '`);
    });

    test("only the missing harness installs", async () => {
      const commands: string[][] = [];
      const installing = installRunner(commands);
      const runner: ProcessRunner = {
        run: (command, runOptions) =>
          command[0] === "claude" ? okRunner.run(command, runOptions) : installing.run(command, runOptions),
      };
      await setup({}, { runner, piReleasesBaseUrl: serveRelease() });
      expect(commands.some((command) => command[0] === "bash")).toBe(false);
      expect(commands.some((command) => command[0] === "tar")).toBe(true);
    });

    test("a script answers yes or no to the installs, and nothing else", async () => {
      let caught: unknown;
      try {
        await setup({ installEngines: "false" }, { interactive: false, runner: scriptedRunner([]) });
      } catch (error) {
        caught = error;
      }
      expect(isEvaError(caught, "config_invalid")).toBe(true);
    });

    test("an installed harness stays as it is", async () => {
      const commands: string[][] = [];
      await setup({}, { runner: scriptedRunner(commands) });
      expect(commands.some((command) => command[0] === "bash" || command[0] === "tar")).toBe(false);
    });

    test("a failed install gives the steps, and setup goes on, in a script too", async () => {
      for (const interactive of [true, false]) {
        const lines: string[] = [];
        await setup(
          { claudeToken: "a-claude-setup-token-value" },
          { interactive, runner: installRunner([], true), lines, piReleasesBaseUrl: serveRelease(true) },
        );
        const text = lines.join("\n");
        expect(text).toContain("the installer broke");
        expect(text).toContain("Run `curl -fsSL https://claude.ai/install.sh | bash`");
        expect(text).toContain("Run `curl -fsSL https://pi.dev/install.sh | sh`");
        expect(loadSecrets(homePaths(home)).claudeOauthToken).toBe("a-claude-setup-token-value");
        void server?.stop(true);
      }
    });
  });

  test("a port that another program uses is not suggested", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      const port = taken.port ?? 0;
      expect(await firstFreePort(port)).toBeGreaterThan(port);
      expect(await firstFreePort(port + 1)).toBeGreaterThan(port);
    } finally {
      await taken.stop(true);
    }
  });

  test("the port of another Eva on this computer is not suggested, even while she is stopped", async () => {
    mkdirSync(join(root, "eva-other"));
    writeFileSync(join(root, "eva-other", "config.json"), JSON.stringify({ port: defaultConfig.port }));
    await setup({});
    expect(loadSettings(homePaths(home)).config.port).toBeGreaterThan(defaultConfig.port);
    expect(await firstFreePort(defaultConfig.port, new Set([defaultConfig.port]))).toBeGreaterThan(defaultConfig.port);
  });

  test("Eva clones the vault from its repository into her home, with the GitHub token", async () => {
    const remote = createGitSandbox();
    try {
      const commands: { command: string[]; token: string | undefined }[] = [];
      const recording: ProcessRunner = {
        run: (command, options) => {
          if (command[0] === "git")
            commands.push({ command: [...command], token: options.environment["EVA_GITHUB_TOKEN"] });
          return gitRunner.run(command, options);
        },
      };
      const lines: string[] = [];
      const asked: SetupQuestion[] = [];
      await setup(
        { githubToken: "token-for-the-test", vaultRepository: remote.remote },
        { runner: recording, lines, asked },
      );
      const config = loadSettings(homePaths(home)).config;
      expect(config.vaultPath).toBe(join(home, "vault"));
      expect(readFileSync(join(home, "vault", "AGENTS.md"), "utf8")).toContain("# Vault");
      expect(loadSecrets(homePaths(home)).githubToken).toBe("token-for-the-test");
      expect(commands[0]?.command).toContain("ls-remote");
      expect(commands[1]?.command).toContain("clone");
      expect(commands[1]?.token).toBe("token-for-the-test");
      expect(lines.join("\n")).toContain("Cloned the vault into");
      // With a repository, the folder has a default, so a person is not asked for it.
      expect(asked).not.toContain("vault");
      expect(loadGitHubAccount(homePaths(home))).toEqual({ id: 1234, login: "example-user", name: "Example User" });
      expect(lines.join("\n")).toContain(
        "Eva signs her commits as Example User <1234+example-user@users.noreply.github.com>.",
      );
    } finally {
      remote.dispose();
    }
  });

  test("a setup that keeps a saved token reads its account, so an older install gets its commit identity", async () => {
    saveSecrets(homePaths(home), { githubToken: "token-for-the-test" });
    await setup({ vault: existingVault }, { interactive: false });
    expect(loadGitHubAccount(homePaths(home))?.login).toBe("example-user");
  });

  test("a repository that git cannot read is asked again, with git's reason, and nothing is lost", async () => {
    const remote = createGitSandbox();
    try {
      const lines: string[] = [];
      const missing = join(home, "no-such-repository");
      await setup(
        {
          githubToken: ["token-for-the-test", ""],
          vaultRepository: [missing, remote.remote],
          timeZone: "Europe/Madrid",
        },
        { runner: gitRunner, lines },
      );
      expect(lines.join("\n")).toContain(`git could not read ${missing}`);
      expect(readFileSync(join(home, "vault", "AGENTS.md"), "utf8")).toContain("# Vault");
      expect(loadSecrets(homePaths(home)).githubToken).toBe("token-for-the-test");
    } finally {
      remote.dispose();
    }
  });

  test("without a person to ask, a repository that git cannot read stops setup", async () => {
    const missing = join(home, "no-such-repository");
    let caught: unknown;
    try {
      await setup({ vaultRepository: missing }, { interactive: false, runner: gitRunner });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
    expect(String(caught)).toContain(`git could not read ${missing}`);
  });

  describe("the GitHub login", () => {
    const githubVault = "https://github.com/example/vault";
    const tokenRunner = (tokens: (string | undefined)[]): ProcessRunner => ({
      run: (command, options) => {
        if (command[0] === "git") tokens.push(options.environment["EVA_GITHUB_TOKEN"]);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    });
    const browserLogin = (logins: string[]): NonNullable<SetupOptions["githubLogin"]> => {
      return (show) => {
        show("ABCD-1234", "https://github.com/login/device");
        logins.push("login");
        return Promise.resolve(`gho_browser_token_${String(logins.length)}`);
      };
    };

    test("Enter logs in with the browser: setup says the access, shows the code, and saves the token", async () => {
      const lines: string[] = [];
      const logins: string[] = [];
      const tokens: (string | undefined)[] = [];
      await setup(
        { vaultRepository: githubVault },
        { lines, runner: tokenRunner(tokens), githubLogin: browserLogin(logins) },
      );
      const text = lines.join("\n");
      expect(text).toContain("read and write all your GitHub repositories");
      expect(text).toContain(
        "Open https://github.com/login/device and enter the code ABCD-1234. Setup waits until you confirm. Press Ctrl+C to stop setup.",
      );
      expect(logins).toEqual(["login"]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_browser_token_1");
      expect(tokens.every((token) => token === "gho_browser_token_1")).toBe(true);
    });

    test("with a saved token, Enter keeps it, and login logs in again", async () => {
      const logins: string[] = [];
      await setup(
        { githubToken: "a-pasted-token", vaultRepository: githubVault },
        { githubLogin: browserLogin(logins) },
      );
      expect(logins).toEqual([]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("a-pasted-token");
      rmSync(join(home, "vault"), { recursive: true, force: true });
      await setup({ vaultRepository: githubVault }, { githubLogin: browserLogin(logins) });
      expect(logins).toEqual([]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("a-pasted-token");
      rmSync(join(home, "vault"), { recursive: true, force: true });
      await setup({ githubToken: "Login", vaultRepository: githubVault }, { githubLogin: browserLogin(logins) });
      expect(logins).toEqual(["login"]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_browser_token_1");
    });

    test("skip skips the login, and a failed login offers a pasted token instead", async () => {
      const logins: string[] = [];
      await setup({ githubToken: "Skip", vaultRepository: githubVault }, { githubLogin: browserLogin(logins) });
      expect(logins).toEqual([]);
      expect(loadSecrets(homePaths(home)).githubToken).toBeUndefined();
      rmSync(join(home, "vault"), { recursive: true, force: true });
      const lines: string[] = [];
      const asked: SetupQuestion[] = [];
      await setup(
        { githubToken: ["", "a-pasted-token"], vaultRepository: githubVault },
        {
          lines,
          asked,
          githubLogin: () => Promise.reject(new EvaError("github_failed", "The GitHub login was refused.")),
        },
      );
      expect(lines.join("\n")).toContain("The GitHub login was refused.");
      expect(asked.filter((key) => key === "githubToken")).toHaveLength(2);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("a-pasted-token");
    });

    test("a script gets the token question, never the login", async () => {
      const logins: string[] = [];
      const lines: string[] = [];
      await setup(
        { githubToken: "", vaultRepository: githubVault },
        { interactive: false, githubLogin: browserLogin(logins), lines },
      );
      expect(lines.join("\n")).not.toContain("The login lets Eva");
      expect(logins).toEqual([]);
    });

    test("a token pasted at the login question serves a vault on another host", async () => {
      const logins: string[] = [];
      await setup(
        { vaultRepository: "https://git.example.com/you/vault", githubToken: "a-pasted-token" },
        { githubLogin: browserLogin(logins) },
      );
      expect(logins).toEqual([]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("a-pasted-token");
      expect(loadSettings(homePaths(home)).config.vaultPath).toBe(join(home, "vault"));
    });

    test("the login comes before the vault question: Enter logs in, and skip leaves an SSH vault without it", async () => {
      const logins: string[] = [];
      const githubLogin = browserLogin(logins);
      const asked: SetupQuestion[] = [];
      await setup({ githubToken: "skip", vaultRepository: "git@github.com:example/vault.git" }, { githubLogin, asked });
      expect(logins).toEqual([]);
      expect(asked.indexOf("githubToken")).toBeLessThan(asked.indexOf("vaultRepository"));
      rmSync(join(home, "vault"), { recursive: true, force: true });
      await setup({ vaultRepository: "ssh://git@github.com/example/vault.git" }, { githubLogin });
      expect(logins).toEqual(["login"]);
    });

    test("with a ready vault, as in a rerun, Enter skips the login and login starts it", async () => {
      const logins: string[] = [];
      const githubLogin = browserLogin(logins);
      await setup({ githubToken: "skip", vault: existingVault }, { githubLogin });
      await setup({}, { githubLogin });
      expect(logins).toEqual([]);
      await setup({ githubToken: "login" }, { githubLogin });
      expect(logins).toEqual(["login"]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_browser_token_1");
    });
  });

  describe("the list of repositories after the login", () => {
    const listed = (fullName: string, cloneUrl: string, extra: Record<string, unknown> = {}): unknown => ({
      full_name: fullName,
      clone_url: cloneUrl,
      private: true,
      archived: false,
      ...extra,
    });

    test("the person picks the vault by its number or its name, and a wrong number is asked again", async () => {
      const remote = createGitSandbox();
      try {
        githubApi.list = {
          status: 200,
          body: [listed("you/notes", "https://github.com/you/notes.git"), listed("you/vault", remote.remote)],
        };
        const lines: string[] = [];
        const asked: SetupQuestion[] = [];
        await setup(
          { githubToken: "a-pasted-token", vaultRepository: ["7", "2"] },
          { runner: gitRunner, lines, asked },
        );
        const text = lines.join("\n");
        expect(text).toContain("  0. Create a new vault\n  1. you/notes (private)\n  2. you/vault (private)");
        expect(text).toContain("No repository has the number 7.");
        expect(readFileSync(join(home, "vault", "AGENTS.md"), "utf8")).toContain("# Vault");
        expect(asked).not.toContain("vault");
        rmSync(join(home, "vault"), { recursive: true, force: true });
        await setup({ vaultRepository: "Vault" }, { runner: gitRunner });
        expect(readFileSync(join(home, "vault", "AGENTS.md"), "utf8")).toContain("# Vault");
      } finally {
        remote.dispose();
      }
    });

    test("only the 15 repositories pushed most recently are shown, and a name reaches the others", async () => {
      githubApi.list = {
        status: 200,
        body: Array.from({ length: 20 }, (_, index) =>
          listed(`you/repository-${String(index + 1)}`, `https://github.com/you/repository-${String(index + 1)}.git`),
        ),
      };
      const commands: string[][] = [];
      const recording: ProcessRunner = {
        run: (command, options) => {
          commands.push([...command]);
          return okRunner.run(command, options);
        },
      };
      const lines: string[] = [];
      await setup({ githubToken: "a-pasted-token", vaultRepository: "repository-20" }, { runner: recording, lines });
      expect(lines.join("\n")).toContain("15. you/repository-15");
      expect(lines.join("\n")).not.toContain("16. you/repository-16");
      expect(commands.find((command) => command.includes("clone"))).toContain(
        "https://github.com/you/repository-20.git",
      );
    });

    test("an unknown or shared name is asked again, owner/name reaches any repository, and Enter skips", async () => {
      githubApi.list = {
        status: 200,
        body: [
          listed("you/vault", "https://github.com/you/vault.git"),
          listed("team/vault", "https://github.com/team/vault.git"),
        ],
      };
      const commands: string[][] = [];
      const recording: ProcessRunner = {
        run: (command, options) => {
          commands.push([...command]);
          return okRunner.run(command, options);
        },
      };
      const lines: string[] = [];
      await setup(
        { githubToken: "a-pasted-token", vaultRepository: ["vualt", "vault", "old/notes.git"] },
        { runner: recording, lines },
      );
      const text = lines.join("\n");
      expect(text).toContain("No repository is named vualt.");
      expect(text).toContain("Several repositories are named vault: you/vault, team/vault.");
      expect(commands.find((command) => command.includes("clone"))).toContain("https://github.com/old/notes.git");
      expect(commands.some((command) => command.includes("vualt"))).toBe(false);
      rmSync(join(home, "vault"), { recursive: true, force: true });
      rmSync(homePaths(home).config);
      const asked: SetupQuestion[] = [];
      await setup({}, { asked });
      expect(asked).not.toContain("vault");
      expect(asked).not.toContain("createVault");
      expect(loadSettings(homePaths(home)).config.vaultPath).toBeNull();
    });

    test("Enter at the list after a repository that git cannot read means no vault, with no other question", async () => {
      const missing = join(home, "no-such-repository");
      const lines: string[] = [];
      const asked: SetupQuestion[] = [];
      await setup(
        { githubToken: "a-pasted-token", vaultRepository: [missing, ""] },
        { runner: gitRunner, lines, asked },
      );
      expect(lines.join("\n")).toContain(`git could not read ${missing}`);
      expect(asked).not.toContain("createVault");
      expect(existsSync(join(home, "vault", "AGENTS.md"))).toBe(false);
    });

    test("a token that cannot list the repositories gets the address question instead", async () => {
      githubApi.list = { status: 403, body: { message: "Resource not accessible by personal access token" } };
      const lines: string[] = [];
      const asked: SetupQuestion[] = [];
      await setup(
        { githubToken: "a-fine-grained-token", vaultRepository: "https://github.com/you/vault" },
        { lines, asked },
      );
      const text = lines.join("\n");
      expect(text).toContain("Eva could not list your GitHub repositories.");
      expect(text).toContain("Resource not accessible by personal access token");
      expect(text).not.toContain("a-fine-grained-token");
      expect(text).not.toContain("0. Create a new vault");
      expect(loadSettings(homePaths(home)).config.vaultPath).toBe(join(home, "vault"));
    });
  });

  test("the GitHub token is saved before the clone, so a failed clone keeps it", async () => {
    const cloneFails: ProcessRunner = {
      run: (command) =>
        Promise.resolve(
          command.includes("clone")
            ? { exitCode: 128, stdout: "", stderr: "network down" }
            : { exitCode: 0, stdout: "", stderr: "" },
        ),
    };
    let caught: unknown;
    try {
      await setup(
        { githubToken: "token-for-the-test", vaultRepository: "https://github.com/example/vault" },
        { runner: cloneFails },
      );
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "git_failed")).toBe(true);
    expect(loadSecrets(homePaths(home)).githubToken).toBe("token-for-the-test");
  });

  test("with no time zone set or answered, setup keeps the computer's own time zone", async () => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await setup({});
    expect(loadSettings(homePaths(home)).config.timeZone).toBe(detected);
    rmSync(homePaths(home).config);
    await setup({}, { interactive: false });
    expect(loadSettings(homePaths(home)).config.timeZone).toBe(detected);
  });

  test("a rerun while this home's Eva runs keeps her port", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      const port = taken.port ?? 0;
      await setup({ port: String(port) }, { interactive: false });
      writeFileSync(homePaths(home).lock, String(process.pid));
      await setup({});
      expect(loadSettings(homePaths(home)).config.port).toBe(port);
    } finally {
      await taken.stop(true);
    }
  });

  describe("each answer is saved at once (#137)", () => {
    test("a change from the web page during setup stays", async () => {
      const paths = homePaths(home);
      await runSetup({
        paths,
        ask: (key) => {
          // The page saves a token and a setting while the terminal waits at this question.
          if (key === "trustedOwners") {
            saveSecrets(paths, { ...loadSecrets(paths), telegramBotToken: "123456:from-the-page" });
            changeSettings(paths, { voice: { language: "es" } });
            return Promise.resolve("owner");
          }
          return Promise.resolve(key === "claudeToken" ? "a-claude-setup-token-value" : "");
        },
        write: () => undefined,
        newToken: () => "generated-token",
        interactive: true,
        runner: okRunner,
        environment: gitEnvironment,
        githubLogin: null,
        platform: "linux",
        userHome: home,
        installEnvironment: gitEnvironment,
        arch: "x64",
      });
      expect(loadSecrets(paths)).toMatchObject({
        telegramBotToken: "123456:from-the-page",
        claudeOauthToken: "a-claude-setup-token-value",
      });
      expect(loadSettings(paths).config.voice.language).toBe("es");
      expect(loadSettings(paths).config.trust.trustedRepositoryOwners).toEqual(["owner"]);
    });

    test("Ctrl+C at a question keeps every answer before it", async () => {
      const failing = runSetup({
        paths: homePaths(home),
        ask: (key) =>
          key === "telegramToken"
            ? Promise.reject(new Error("Ctrl+C"))
            : Promise.resolve(key === "claudeToken" ? "a-claude-setup-token-value" : ""),
        write: () => undefined,
        newToken: () => "generated-token",
        interactive: true,
        runner: okRunner,
        environment: gitEnvironment,
        githubLogin: null,
        platform: "linux",
        userHome: home,
        installEnvironment: gitEnvironment,
        arch: "x64",
      });
      expect(
        await failing.then(
          () => null,
          (error: unknown) => String(error),
        ),
      ).toContain("Ctrl+C");
      expect(loadSecrets(homePaths(home))).toMatchObject({
        claudeOauthToken: "a-claude-setup-token-value",
        localApiToken: "generated-token",
      });
    });

    test("a person is not asked again for a step done already; a script still sets it", async () => {
      saveSecrets(homePaths(home), { claudeOauthToken: "a-saved-token-value" });
      const asked: SetupQuestion[] = [];
      await setup({}, { asked });
      expect(asked).not.toContain("claudeToken");
      expect(asked).toContain("telegramToken");
      await setup({ claudeToken: "a-new-token-value" }, { interactive: false });
      expect(loadSecrets(homePaths(home)).claudeOauthToken).toBe("a-new-token-value");
    });

    test("a ready vault still lets a rerun give the GitHub token, and a half Google client is asked again", async () => {
      await setup({ vault: existingVault, googleEmail: "person@example.com", googleClientId: "client-id" });
      const asked: SetupQuestion[] = [];
      await setup({ githubToken: "ghp_a-token-for-projects" }, { asked });
      expect(asked).not.toContain("vaultRepository");
      expect(loadSecrets(homePaths(home)).githubToken).toBe("ghp_a-token-for-projects");
      expect(asked).toContain("googleClientSecret");
    });

    test("a ready vault offers the GitHub browser login for private projects", async () => {
      await setup({ vault: existingVault }, { interactive: false });
      await setup(
        { githubToken: "login" },
        {
          githubLogin: (show) => (
            show("ABCD-1234", "https://github.com/login/device"),
            Promise.resolve("gho_from_browser")
          ),
        },
      );
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_from_browser");
    });

    test("an existing vault keeps its own shared settings", async () => {
      mkdirSync(join(existingVault, ".eva"), { recursive: true });
      writeFileSync(join(existingVault, ".eva", "settings.json"), JSON.stringify({ updates: { frequency: "weekly" } }));
      await setup({ vault: existingVault }, { interactive: false });
      expect(loadSettings(homePaths(home)).config.updates.frequency).toBe("weekly");
    });

    test("a script's engine answer wins over the engine that a vault brings", async () => {
      mkdirSync(join(existingVault, ".eva"), { recursive: true });
      writeFileSync(
        join(existingVault, ".eva", "settings.json"),
        JSON.stringify({ engines: { default: "claude-code" } }),
      );
      await setup({ vault: existingVault, engine: "pi" }, { interactive: false });
      expect(loadSettings(homePaths(home)).config.engines.default).toBe("pi");
    });

    test("setup reports whether it changed anything after Eva started", async () => {
      const run = (answers: Partial<Record<SetupQuestion, string>>): Promise<{ changedAfterStart: boolean }> =>
        runSetup({
          paths: homePaths(home),
          ask: (key) => Promise.resolve(answers[key] ?? ""),
          write: () => undefined,
          newToken: () => "generated-token",
          interactive: true,
          runner: okRunner,
          environment: gitEnvironment,
          githubLogin: null,
          platform: "linux",
          userHome: home,
          installEnvironment: gitEnvironment,
          arch: "x64",
          afterEssentials: () => Promise.resolve(),
        });
      expect(await run({ claudeToken: "a-claude-setup-token-value" })).toEqual({ changedAfterStart: true });
      // Every step is done now, so a rerun saves nothing.
      expect(await run({})).toEqual({ changedAfterStart: false });
    });
  });

  test("a Telegram chat id skips the pairing code; a wrong one is refused", async () => {
    const lines: string[] = [];
    await setup({ telegramToken: "123456:telegram-token-value", telegramChatId: "my chat" }, { lines });
    expect(lines.join("\n")).toContain("whole number");
    await setup({ telegramChatId: "-100123" });
    expect(loadSettings(homePaths(home)).config.telegram.allowedChatId).toBe(-100123);
    let caught: unknown;
    try {
      await setup({ telegramChatId: "my chat" }, { interactive: false });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
  });

  test("a person is not asked for the port: setup takes a free one", async () => {
    const asked: SetupQuestion[] = [];
    await setup({ port: "7500" }, { asked });
    expect(asked).not.toContain("port");
    expect(loadSettings(homePaths(home)).config.port).not.toBe(7500);
  });

  test("without a person to ask, a bad port stops setup", async () => {
    let caught: unknown;
    try {
      await setup({ port: "high" }, { interactive: false });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
  });

  test("Create a new vault makes a private repository through the GitHub API and pushes the template, with no gh", async () => {
    const bare = emptyRepository("my-vault");
    githubApi.create = (name) => ({
      status: 201,
      body: { full_name: `you/${name}`, clone_url: bare, private: true },
    });
    const commands: string[][] = [];
    const recordingRunner: ProcessRunner = {
      run: (command, options) => {
        commands.push([...command]);
        return gitRunner.run(command, options);
      },
    };
    const lines: string[] = [];
    const asked: SetupQuestion[] = [];
    await setup(
      {
        githubToken: "a-pasted-token",
        vaultRepository: "0",
        name: "Alex",
        topics: "Work, music",
        githubRepository: "my-vault",
      },
      { runner: recordingRunner, lines, asked },
    );
    const newVault = join(home, "vault");
    const assistant = readFileSync(join(newVault, ".eva", "assistant.md"), "utf8");
    expect(assistant).toContain("- **Name:** Alex");
    expect(assistant).toContain("- Work\n- music\n");
    // "0" already answers both questions: a new vault, in Eva's home.
    expect(asked).not.toContain("createVault");
    expect(asked).not.toContain("vault");
    expect(githubApi.created).toEqual(["my-vault"]);
    // gh only checks the instance's own login; the vault needs none of it.
    expect(commands.filter((command) => command[0] === "gh").every((command) => command[1] === "auth")).toBe(true);
    expect(lines.join("\n")).toContain("Created the private repository you/my-vault.");
    const pushed = Bun.spawnSync(["git", "log", "--format=%s", "main"], { cwd: bare, env: gitEnvironment });
    expect(pushed.stdout.toString()).toContain("Start the vault");
  });

  test("a refused new vault leaves the folder empty, and a name that exists asks again, or takes an address", async () => {
    const emptyFolder = join(home, "empty");
    await setup({ vault: emptyFolder, createVault: "no" });
    expect(existsSync(join(emptyFolder, "AGENTS.md"))).toBe(false);
    githubApi.create = () => ({
      status: 422,
      body: { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] },
    });
    const bare = emptyRepository("made-by-hand");
    const lines: string[] = [];
    await setup(
      {
        githubToken: "a-pasted-token",
        vaultRepository: "0",
        githubRepository: ["vault", pathToFileURL(bare).href],
      },
      { runner: gitRunner, lines },
    );
    const text = lines.join("\n");
    expect(text).toContain("name already exists on this account");
    expect(text).toContain("create an empty private repository on github.com, and paste its address");
    expect(text).toContain(`Pushed the vault to ${pathToFileURL(bare).href}.`);
    expect(githubApi.created).toEqual(["vault"]);
  });

  test("a push that fails after the create pushes to the same repository on a retry with the same name", async () => {
    const bare = emptyRepository("vault");
    githubApi.create = (name) => ({
      status: 201,
      body: { full_name: `you/${name}`, clone_url: pathToFileURL(bare).href, private: true },
    });
    let pushes = 0;
    const firstPushFails: ProcessRunner = {
      run: (command, options) => {
        if (command.includes("push") && (pushes += 1) === 1)
          return Promise.resolve({ exitCode: 128, stdout: "", stderr: "network down" });
        return gitRunner.run(command, options);
      },
    };
    const lines: string[] = [];
    await setup(
      { githubToken: "a-pasted-token", vaultRepository: "0", githubRepository: ["vault", "vault"] },
      { runner: firstPushFails, lines },
    );
    expect(lines.join("\n")).toContain("Type the same name to push again");
    expect(githubApi.created).toEqual(["vault"]);
    const pushed = Bun.spawnSync(["git", "log", "--format=%s", "main"], { cwd: bare, env: gitEnvironment });
    expect(pushed.stdout.toString()).toContain("Start the vault");
  });

  test("a new vault with no GitHub login stays local, and a rerun offers the push again", async () => {
    const lines: string[] = [];
    await setup({ githubToken: "", vault: join(home, "local"), createVault: "y" }, { runner: gitRunner, lines });
    expect(lines.join("\n")).toContain("To keep the vault in a private GitHub repository, log in to GitHub");
    const bare = emptyRepository("later");
    const asked: SetupQuestion[] = [];
    await setup(
      { githubToken: "a-pasted-token", githubRepository: pathToFileURL(bare).href },
      { runner: gitRunner, asked },
    );
    expect(asked).toContain("githubRepository");
    const pushed = Bun.spawnSync(["git", "log", "--format=%s", "main"], { cwd: bare, env: gitEnvironment });
    expect(pushed.stdout.toString()).toContain("Start the vault");
    // Once pushed, a rerun asks no more.
    asked.length = 0;
    await setup({}, { runner: gitRunner, asked });
    expect(asked).not.toContain("githubRepository");
  });

  test("a script with a token makes the new vault's repository through the GitHub API too", async () => {
    const bare = emptyRepository("scripted");
    githubApi.create = (name) => ({ status: 201, body: { full_name: `you/${name}`, clone_url: bare, private: true } });
    await setup(
      { githubToken: "a-script-token", vault: join(home, "scripted"), createVault: "y", githubRepository: "scripted" },
      { interactive: false, runner: gitRunner },
    );
    expect(githubApi.created).toEqual(["scripted"]);
    const pushed = Bun.spawnSync(["git", "log", "--format=%s", "main"], { cwd: bare, env: gitEnvironment });
    expect(pushed.stdout.toString()).toContain("Start the vault");
    // The first commit carries the account's name, not the computer user's git settings.
    const author = Bun.spawnSync(["git", "log", "-1", "--format=%an <%ae>", "main"], {
      cwd: bare,
      env: gitEnvironment,
    });
    expect(author.stdout.toString().trim()).toBe("Example User <1234+example-user@users.noreply.github.com>");
  });

  test("a setup with a new token never keeps the old account when GitHub does not answer", async () => {
    saveGitHubAccount(homePaths(home), { id: 1, login: "old-account", name: "Old Account" });
    githubApi.user = { status: 401, body: { message: "Bad credentials" } };
    await setup({ vault: existingVault, githubToken: "a-new-token" });
    expect(loadSecrets(homePaths(home)).githubToken).toBe("a-new-token");
    expect(loadGitHubAccount(homePaths(home))).toBeNull();
  });

  test("each instance hears about its own engine logins first, and gets a login report at the end", async () => {
    const lines: string[] = [];
    const ghEnvironments: Readonly<Record<string, string>>[] = [];
    const runner: ProcessRunner = {
      run: (command, options) => {
        if (command[0] === "gh") ghEnvironments.push(options.environment);
        return Promise.resolve({ exitCode: command[0] === "gh" ? 1 : 0, stdout: "", stderr: "not logged in" });
      },
    };
    const emptyFolder = join(home, "empty");
    await setup(
      { vault: emptyFolder, createVault: "y", githubRepository: "my-vault", claudeToken: "a-claude-token" },
      { lines, runner },
    );
    const ghFolder = join(home, "engines", "gh");
    const firstStep = lines.findIndex((line) => line.includes("keeps her own logins"));
    expect(firstStep).toBeGreaterThan(-1);
    expect(firstStep).toBeLessThan(lines.findIndex((line) => line.startsWith("Created a new vault")));
    expect(lines.join("\n")).toContain(`GH_CONFIG_DIR='${ghFolder}' gh auth login --insecure-storage`);
    // The gh login check uses this instance's gh folder.
    expect(ghEnvironments.length).toBeGreaterThan(0);
    expect(ghEnvironments.every((environment) => environment["GH_CONFIG_DIR"] === ghFolder)).toBe(true);
    expect(lines.join("\n")).toContain("- Claude: token saved.");
    expect(lines.join("\n")).toContain("- GitHub: not logged in.");
  });

  test("a missing Claude token names how to run setup again: this Eva for a person, the variable for a script", async () => {
    const lines: string[] = [];
    await setup({}, { lines });
    expect(lines.join("\n")).toContain("run `eva --instance test setup` again");
    const scriptLines: string[] = [];
    await setup({}, { lines: scriptLines, interactive: false });
    expect(scriptLines.join("\n")).not.toContain("Setup keeps going");
    expect(scriptLines.join("\n")).toContain("run setup again with the token in EVA_CLAUDE_TOKEN");
  });

  test("each question has its own environment variable for --non-interactive", () => {
    const names = Object.values(setupEnvironmentNames);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith("EVA_"))).toBe(true);
  });
});

describe("service", () => {
  test("the systemd unit restarts on a crash, never on bad settings or a second instance (lesson 89)", () => {
    const unit = systemdUnit({
      executable: ["/usr/bin/bun", "/opt/eva/src/main.ts"],
      instance: "ana",
      path: "/usr/bin:/bin",
      configFolder: undefined,
    });
    expect(unit).toContain("ExecStart=/usr/bin/bun /opt/eva/src/main.ts --instance ana");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartPreventExitStatus=2 3");
    expect(unit).toContain("Environment=PATH=/usr/bin:/bin");
    expect(unit).not.toContain("XDG_CONFIG_HOME");
  });

  test("the systemd unit keeps the install's XDG_CONFIG_HOME, so the service finds the same Evas", () => {
    const unit = systemdUnit({ executable: ["eva"], instance: "ana", path: "/usr/bin", configFolder: "/srv/config" });
    expect(unit).toContain("Environment=XDG_CONFIG_HOME=/srv/config");
  });

  test("the service PATH drops the folders that only one `bun run` has", () => {
    expect(
      servicePath("/tmp/bun-node-744846f8:/home/u/eva/node_modules/.bin:/home/u/.bun/bin:/usr/bin::/usr/bin"),
    ).toBe("/home/u/.bun/bin:/usr/bin");
  });

  test("after an update, systemd or the Eva supervisor restarts Eva; anywhere else she starts a new copy", () => {
    const alive = (pid: number): boolean => pid === 42;
    expect(restartMethod({ INVOCATION_ID: "abc" }, alive, 1)).toBe("supervisor");
    expect(restartMethod({ EVA_SUPERVISED: "42" }, alive, 42)).toBe("supervisor");
    expect(restartMethod({}, alive, 42)).toBe("new-copy");
  });

  test("an Eva whose supervisor has ended starts a new copy, so an update never leaves her stopped", () => {
    const alive = (pid: number): boolean => pid === 42;
    expect(restartMethod({ EVA_SUPERVISED: "7" }, alive, 7)).toBe("new-copy");
    expect(restartMethod({ EVA_SUPERVISED: "yes" }, alive, 42)).toBe("new-copy");
    // An orphan gets a new parent; another process may now hold the supervisor's old pid.
    expect(restartMethod({ EVA_SUPERVISED: "42" }, alive, 1)).toBe("new-copy");
  });

  test("each Eva on the same machine gets her own service, named after her", () => {
    expect(serviceName(homePaths("/u/.config/eva-ana"))).toBe("eva-ana");
    expect(serviceName(homePaths("/u/.config/eva-eva"))).toBe("eva-eva");
    expect(windowsTaskCommand({ executable: ["eva.exe"], instance: "ana" }, "eva-ana")).toContain("Eva-ana");
  });

  test("the Windows task starts the Eva supervisor at logon, which restarts her after a crash", () => {
    expect(
      windowsTaskCommand({ executable: ["C:/bun/bun.exe", "C:/eva/src/main.ts"], instance: "ana" }, "eva-ana"),
    ).toEqual([
      "schtasks",
      "/Create",
      "/F",
      "/SC",
      "ONLOGON",
      "/TN",
      "Eva-ana",
      "/TR",
      '"C:/bun/bun.exe" "C:/eva/src/main.ts" supervise --instance ana',
    ]);
  });

  test("the Windows task runs with no time limit, and on battery too, so Windows never stops the supervisor", () => {
    const command = windowsTaskSettingsCommand("eva-partner");
    expect(command.slice(0, 4)).toEqual(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"]);
    const script = command[4] ?? "";
    expect(script).toContain("Set-ScheduledTask -TaskName 'Eva-partner'");
    expect(script).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
    expect(script).toContain("-AllowStartIfOnBatteries");
    expect(script).toContain("-DontStopIfGoingOnBatteries");
    // Without it, a failed Set-ScheduledTask still exits 0, and the install would say nothing.
    expect(script).toContain("-ErrorAction Stop");
  });

  test("after the install, the Windows task starts at once, under the same name", () => {
    expect(windowsRunTaskCommand("eva-partner")).toEqual(["schtasks", "/Run", "/TN", "Eva-partner"]);
  });
});

describe("runChat", () => {
  let sandbox: GitSandbox;
  let home: string;
  let eva: Eva;
  let api: LocalApi;
  let vault: string;

  beforeEach(() => {
    sandbox = createGitSandbox();
    vault = sandbox.clone("vault");
    sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", "eva");
    sandbox.git(vault, "push", "-q", "origin", "main");
    home = mkdtempSync(join(tmpdir(), "eva-chat-"));
    eva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [
        new FakeEngine(async function* (request) {
          if (!request.prompt.endsWith("push it")) {
            yield* FakeEngine.answer(request, "Hi! I am Eva.");
            return;
          }
          const answer = await request.requestApproval({ requestId: "", toolName: "Bash", summary: "git push" });
          yield* FakeEngine.answer(request, `The push was ${answer === "allow" ? "allowed" : "denied"}.`);
        }),
      ],
      runner: { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) },
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      gatherMs: 5,
    });
    api = startLocalApi({ eva, port: 0, token: "chat-token", extraHosts: [], allowedTailscaleIdentities: [] });
  }, gitHookTimeoutMs);
  afterEach(async () => {
    await eva.idle();
    api.stop();
    eva.stop();
    sandbox.dispose();
    rmSync(home, { recursive: true, force: true });
  }, gitHookTimeoutMs);

  test("eva work names the chat that reports back, or says what failed", async () => {
    const options = { baseUrl: api.url, token: "chat-token" };
    const failure: unknown = await startProjectWork(options, {
      projectId: "missing",
      request: "x",
      reportToSessionId: "s1",
    }).catch((caught: unknown) => caught);
    expect(String(failure)).toContain("404");
    sandbox.write(
      vault,
      "Projects/2025-03-02-1015-example-app/AGENTS.md",
      `---
created: 2025-03-02T10:15
repos:
  - ${sandbox.remote}
---
`,
    );
    const started = await startProjectWork(options, {
      projectId: "2025-03-02-1015-example-app",
      request: "fix the bug",
      reportToSessionId: null,
    });
    expect(started).toMatch(/^Started the work in clone remote-0, chat \S+\.$/);
  });

  test("eva projects filters by status and tag, and shows the tags and the warnings", async () => {
    const options = { baseUrl: api.url, token: "chat-token" };
    sandbox.write(
      vault,
      "Projects/2025-02-01-0900-tax-report/AGENTS.md",
      "---\ncreated: 2025-02-01T09:00\nstatus: active\ntags: [life, money]\n---\n# Taxes\n",
    );
    sandbox.write(vault, "Projects/2024-01-01-0900-photo-sorter/AGENTS.md", "---\ncreated: 2024-01-01T09:00\n---\n");
    expect(await describeProjects(options, "status:active")).toBe(
      "2025-02-01-0900-tax-report  active  Taxes  #life #money",
    );
    expect(await describeProjects(options, "#MONEY")).toStartWith("2025-02-01-0900-tax-report");
    expect(await describeProjects(options, "sorter")).toBe(
      "2024-01-01-0900-photo-sorter  ?  photo-sorter\n  ⚠ status must be idea, active, paused or closed",
    );
  });

  test("status and projects print short text", async () => {
    const before = await describeStatus({ baseUrl: api.url, token: "chat-token" });
    expect(before).toContain("Vault sync: ok");
    expect(before).toMatch(/^All good\nEva \d+\.\d+\.\d+, hub: this machine \(\S+\)/);
    expect(before).toContain("Last turn: none since start");
    // The versions of Claude Code and the other tools show too, as on the Updates page.
    expect(before).toMatch(/\nTools: /);
    const session = eva.createAssistantSession({ source: "cli", model: "default" });
    await eva.sessions.send(session.id, "hi");
    // The cache counts show in every status, so a broken prompt cache is visible (lesson 120).
    expect(await describeStatus({ baseUrl: api.url, token: "chat-token" })).toContain(
      "Last turn: 10 in, 5 out, cache 0 read, 0 written",
    );
    expect(await describeProjects({ baseUrl: api.url, token: "chat-token" }, "nothing")).toBe("No project matches.");
    expect(await describeProjects({ baseUrl: api.url, token: "chat-token" }, "")).toBe("No project matches.");
    const error: unknown = await describeStatus({ baseUrl: api.url, token: "wrong" }).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toContain("401");
  });

  test("update, sync and settings commands go through the running Eva", async () => {
    const options = { baseUrl: api.url, token: "chat-token" };
    expect(String(await requestUpdate(options, true).catch((caught: unknown) => caught))).toContain("409");
    expect(String(await requestUpdate(options, false, "1.0.0").catch((caught: unknown) => caught))).toContain("409");
    expect(await requestSync(options)).toStartWith("Vault sync: ");
    expect(await requestHub(options)).toContain("is now the hub.");
    expect((await requestStatus(options)).localUrl).toStartWith("http://127.0.0.1:");
    expect(await requestSettingsChange(options, { updates: { frequency: "weekly" } })).toBe(false);
    expect(await requestSettingsChange(options, { timeZone: "Europe/Madrid" })).toBe(true);
    expect(String(await requestSettingsChange(options, { port: 5 }).catch((caught: unknown) => caught))).toContain(
      "400",
    );
  });

  test("sends each line, prints the answer, and stops at /exit", async () => {
    const lines = ["Hello", "/exit"];
    const output: string[] = [];
    await runChat({
      baseUrl: api.url,
      token: "chat-token",
      mode: "assistant",
      model: "default",
      readLine: () => Promise.resolve(lines.shift() ?? null),
      write: (text) => output.push(text),
    });
    expect(output.join("")).toContain("Hi! I am Eva.");
  });

  test("/rename renames the chat, and a bare /rename shows how to use it (issue 46)", async () => {
    const lines = ["/rename\tTrip plans", "/rename", "/exit"];
    const output: string[] = [];
    await runChat({
      baseUrl: api.url,
      token: "chat-token",
      mode: "assistant",
      model: "default",
      readLine: () => Promise.resolve(lines.shift() ?? null),
      write: (text) => output.push(text),
    });
    const text = output.join("");
    expect(text).toContain("The chat is now called Trip plans.");
    expect(text).toContain("Use: /rename <title>");
    expect(eva.sessions.list()[0]?.title).toBe("Trip plans");
  });

  test("an approval is asked in the terminal, with y or n", async () => {
    const lines = ["push it", "y", "push it", "no", "/exit"];
    const output: string[] = [];
    await runChat({
      baseUrl: api.url,
      token: "chat-token",
      mode: "assistant",
      model: "default",
      readLine: () => Promise.resolve(lines.shift() ?? null),
      write: (text) => output.push(text),
    });
    const text = output.join("");
    expect(text).toContain("Eva wants to run Bash: git push");
    expect(text).toContain("The push was allowed.");
    expect(text).toContain("The push was denied.");
  });
});

describe("heldBackLines (lesson 26)", () => {
  test("names the files that the sync keeps out, with the reason, and says nothing when there are none", () => {
    expect(heldBackLines([])).toEqual([]);
    expect(
      heldBackLines([
        { path: "Notes/keys.md", reason: "secret" },
        { path: ".env", reason: "secret" },
        { path: "Media/video.mp4", reason: "too_large" },
      ]),
    ).toEqual([
      "Held back from the vault, as they look like secrets: Notes/keys.md, .env",
      "Held back from the vault, as they are over 50 MB: Media/video.mp4",
    ]);
  });
});

describe("describeEngineUpdate", () => {
  const result = { before: "2.1.0", after: "2.2.0", detail: null, at: "2026-10-17T10:00:00Z" };

  test("each state of the engine update reads as one line", () => {
    expect(describeEngineUpdate({ phase: "idle", last: null })).toBe("Claude Code: no update has run yet");
    expect(describeEngineUpdate({ phase: "waiting_for_idle", last: null })).toBe(
      "Claude Code: the update starts when the running chats and Eva's own update end",
    );
    expect(describeEngineUpdate({ phase: "updating", last: null })).toBe("Claude Code: updating…");
    expect(describeEngineUpdate({ phase: "idle", last: { ...result, outcome: "updated" } })).toBe(
      "Claude Code: updated from 2.1.0 to 2.2.0; the next turn uses it",
    );
    expect(
      describeEngineUpdate({ phase: "idle", last: { ...result, after: result.before, outcome: "up_to_date" } }),
    ).toBe("Claude Code: 2.1.0 is the latest");
  });

  test("a failed update says why", () => {
    expect(describeEngineUpdate({ phase: "idle", last: { ...result, outcome: "failed", detail: "No network." } })).toBe(
      "Claude Code: the update failed: No network.",
    );
    expect(describeEngineUpdate({ phase: "idle", last: { ...result, outcome: "failed" } })).toBe(
      "Claude Code: the update failed: unknown reason.",
    );
  });
});

describe("describeUpdate and describeSync", () => {
  const base: UpdateStatus = {
    kind: "source",
    frequency: "daily",
    install: "minor",
    target: null,
    heldBack: null,
    releases: [],
    phase: "idle",
    current: "aaa1111",
    latest: "aaa1111",
    available: false,
    lastCheckAt: "2026-10-17T10:00:00.000Z",
    lastError: null,
    failedStep: null,
  };

  test("a failed install never reads as a failed check", () => {
    expect(describeUpdate({ ...base, lastError: "bun install failed", failedStep: "install" })).toBe(
      "Updates: checks daily; the last install failed: bun install failed",
    );
  });

  test("each state of the updates reads as one line", () => {
    expect(describeUpdate(base)).toBe("Updates: aaa1111 is the latest; checks daily");
    expect(describeUpdate({ ...base, latest: "bbb2222", available: true, frequency: "off" })).toBe(
      "Updates: bbb2222 is available (this is aaa1111); automatic updates off",
    );
    expect(describeUpdate({ ...base, current: null, latest: null })).toBe("Updates: checks daily; not checked yet");
    expect(describeUpdate({ ...base, lastError: "offline", failedStep: "check" })).toBe(
      "Updates: checks daily; the last check failed: offline",
    );
    expect(describeUpdate({ ...base, latest: "bbb2222", phase: "waiting_for_idle" })).toBe(
      "Updates: bbb2222 installs when the running chats end",
    );
    expect(describeUpdate({ ...base, latest: "bbb2222", phase: "updating" })).toBe("Updates: installing bbb2222");
    expect(describeUpdate({ ...base, latest: "bbb2222", phase: "restarting" })).toBe(
      "Updates: bbb2222 is installed; Eva restarts when no chat runs",
    );
  });

  test("a release, the policy's pick and a held-back version each read clearly", () => {
    const release = { ...base, kind: "executable" as const, current: "1.2.0", latest: "2.0.0" };
    expect(describeUpdate({ ...release, available: true, target: "1.3.0", heldBack: "2.0.0" })).toBe(
      "Updates: 1.3.0 is available (this is 1.2.0); 2.0.0 is held back by the update policy (minor); checks daily",
    );
    expect(describeUpdate({ ...release, heldBack: "2.0.0", install: "patch" })).toBe(
      "Updates: this is 1.2.0; 2.0.0 is held back by the update policy (patch); checks daily",
    );
    expect(describeUpdate({ ...release, target: "1.3.0", phase: "waiting_for_idle" })).toBe(
      "Updates: 1.3.0 installs when the running chats end",
    );
  });

  test("a chosen release reads as the jump, with a warning for a major one", () => {
    const release = {
      ...base,
      kind: "executable" as const,
      current: "1.2.0",
      releases: [
        {
          version: "2.0.0",
          notes: "",
          level: "major" as const,
          summary: "Breaking changes:\n• feat!: x (2.0.0)",
          headline: "X.",
          publishedAt: null,
        },
        {
          version: "1.3.0",
          notes: "",
          level: "minor" as const,
          summary: "New features:\n• feat: y (1.3.0)",
          headline: "Y.",
          publishedAt: null,
        },
      ],
    };
    expect(describeRelease(release, "2.0.0")).toBe(
      `Eva 1.2.0 → 2.0.0\n\n${majorUpdateWarning}\n\nBreaking changes:\n• feat!: x (2.0.0)`,
    );
    expect(describeRelease(release, "1.3.0")).toBe("Eva 1.2.0 → 1.3.0\n\nNew features:\n• feat: y (1.3.0)");
    expect(describeRelease(release, "0.9.0")).toBeNull();
    // Below the policy pick, the next check after the restart moves Eva on again.
    expect(describeRelease({ ...release, install: "major", target: "2.0.0" }, "1.3.0")).toEndWith(
      "The update policy (major) installs 2.0.0 after the restart. To stay on 1.3.0, change the policy first.",
    );
  });

  test("in a terminal, a held-back version comes with the command that installs it", () => {
    expect(describeUpdateWithHint({ ...base, heldBack: "2.0.0" })).toEndWith("Run `eva update 2.0.0` to install it.");
    expect(describeUpdateWithHint(base)).toBe(describeUpdate(base));
  });

  test("the sync line names the reason of a problem", () => {
    const state = { status: "ok" as const, lastCommitAt: null, lastPushAt: null, lastError: null, withheldFiles: [] };
    expect(describeSync(state)).toBe("Vault sync: ok");
    expect(describeSync({ ...state, status: "offline", lastError: "Could not reach the remote." })).toBe(
      "Vault sync: offline (Could not reach the remote.)",
    );
  });
});

describe("describeStatusLines", () => {
  const status: EvaStatus = {
    version: "1.2.3",
    vaultPath: "/vault",
    role: "hub",
    machine: "server",
    hub: "server",
    vaultSync: { status: "ok", lastCommitAt: null, lastPushAt: null, lastError: null, withheldFiles: [] },
    sessionCount: 2,
    busySessionIds: [],
    lastTurn: null,
    update: null,
    remoteAccess: null,
    localUrl: "http://127.0.0.1:7420",
    problems: [],
    problemDetails: [],
    setupMissing: 0,
    chatBlocker: null,
  };

  test("starts with All good when nothing is wrong", () => {
    expect(describeStatusLines(status).slice(0, 2)).toEqual(["All good", "Eva 1.2.3, hub: this machine (server)"]);
  });

  test("starts with the number of problems, then one line for each problem", () => {
    const lines = describeStatusLines({ ...status, problems: ["The vault sync failed.", "The update failed."] });
    expect(lines.slice(0, 3)).toEqual(["2 problems", "• The vault sync failed.", "• The update failed."]);
    expect(describeStatusLines({ ...status, problems: ["The vault sync failed."] })[0]).toBe("1 problem");
  });

  test("names the setup steps left, which are not problems", () => {
    const lines = describeStatusLines({ ...status, setupMissing: 2 });
    expect(lines[0]).toBe("All good");
    expect(lines).toContain("Setup: 2 steps left. Open Settings on Eva's page to see them.");
    expect(describeStatusLines(status).join("\n")).not.toContain("Setup:");
  });
});

describe("describeToolVersions", () => {
  test("names each tool that is there, with its version, on one line", () => {
    const tools = [
      { program: "git", feature: "the vault and clones", version: "2.50.0" },
      { program: "claude", feature: "the Claude Code engine", version: "2.1.300" },
      { program: "pi", feature: "the pi engine", version: null },
    ];
    expect(describeToolVersions(tools)).toBe("Tools: git 2.50.0, claude 2.1.300");
    expect(describeToolVersions([])).toBe("Tools: none found");
  });
});

describe("describeLogEntries", () => {
  test("puts each entry on one line: time, level, message and the details", () => {
    expect(
      describeLogEntries([
        { at: "2026-10-14T10:00:00.000Z", level: "warn", message: "Telegram poll failed.", summary: "reason: 502" },
        { at: "2026-10-14T10:05:00.000Z", level: "error", message: "A turn failed.", summary: "" },
      ]),
    ).toBe("2026-10-14 10:00 warn Telegram poll failed. (reason: 502)\n2026-10-14 10:05 error A turn failed.");
  });

  test("says so when the log has no warning or error", () => {
    expect(describeLogEntries([])).toBe("No warnings or errors in the log.");
  });
});

describe("describeRole", () => {
  test("names this machine and the hub", () => {
    expect(describeRole({ role: "hub", machine: "server", hub: "server" })).toBe("hub: this machine (server)");
    expect(describeRole({ role: "satellite", machine: "pc", hub: "server" })).toBe(
      "satellite: the hub is server; this machine is pc",
    );
    expect(describeRole({ role: "satellite", machine: "pc", hub: null })).toContain("the hub is unknown");
  });
});

describe("describeRemoteAccess", () => {
  test("shows the phone address, the next setup step, or nothing when phone access is off", () => {
    expect(describeRemoteAccess(null)).toEqual([]);
    expect(describeRemoteAccess({ url: "https://server.example-tailnet.ts.net", problem: null })).toEqual([
      "Phone access: https://server.example-tailnet.ts.net",
    ]);
    // An older running Eva sends no step: its problem is the reason.
    expect(describeRemoteAccess({ url: null, problem: "Turn on HTTPS" })).toEqual([
      "Phone access: not ready. Turn on HTTPS Run `eva link` for every step.",
    ]);
    expect(describeRemoteAccess({ url: null, problem: null, step: "install", canInstall: true })).toEqual([
      "Phone access: not ready. Install Tailscale on this machine. Eva can install it for you. Run `eva link` for every step.",
    ]);
    expect(describeRemoteAccess({ url: null, problem: null })).toEqual([
      "Phone access: not ready. Eva cannot publish her page. See the warnings in her log. Run `eva link` for every step.",
    ]);
  });
});
