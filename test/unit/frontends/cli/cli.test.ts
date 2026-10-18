import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva, type EvaStatus } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths, loadSecrets } from "../../../../src/core/settings/home.ts";
import { loadSettings } from "../../../../src/core/settings/settings.ts";
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
import { createGitSandbox, gitEnvironment, type GitSandbox, gitHookTimeoutMs } from "../../../support/git-sandbox.ts";

describe("parseArguments", () => {
  test("no command runs the core", () => {
    expect(parseArguments([])).toEqual({ command: "run", home: undefined });
  });

  test("reads --home anywhere, and the options of each command", () => {
    expect(parseArguments(["--home", "/h", "status"])).toEqual({ command: "status", home: "/h" });
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
      home: undefined,
      projectId: "2025-03-02-1015-example-app",
      clone: "example-app-0",
      model: "haiku",
    });
    expect(parseArguments(["projects", "photo", "booth"])).toEqual({
      command: "projects",
      home: undefined,
      query: "photo booth",
    });
    expect(parseArguments(["service", "install"])).toEqual({ command: "service-install", home: undefined });
    expect(parseArguments(["supervise", "--home", "/h"])).toEqual({ command: "supervise", home: "/h" });
    expect(parseArguments(["setup"])).toEqual({ command: "setup", home: undefined, nonInteractive: false });
    expect(parseArguments(["setup", "--non-interactive", "--home", "/h"])).toEqual({
      command: "setup",
      home: "/h",
      nonInteractive: true,
    });
    expect(parseArguments(["doctor"])).toEqual({ command: "doctor", home: undefined });
    expect(parseArguments(["work", "2025-03-02-1015-example-app", "fix", "the", "bug"])).toEqual({
      command: "work",
      home: undefined,
      projectId: "2025-03-02-1015-example-app",
      request: "fix the bug",
    });
    expect(parseArguments(["work", "only-a-project"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["chat", "--engine", "pi"])).toEqual({ command: "chat", home: undefined, engine: "pi" });
    expect(parseArguments(["chat", "--engine", "codex"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["update"])).toEqual({ command: "update", home: undefined, checkOnly: false, version: null });
    expect(parseArguments(["update", "--check"])).toEqual({
      command: "update",
      home: undefined,
      checkOnly: true,
      version: null,
    });
    expect(parseArguments(["update", "1.2.0"])).toEqual({
      command: "update",
      home: undefined,
      checkOnly: false,
      version: "1.2.0",
    });
    expect(parseArguments(["update", "v1.2.0"])).toMatchObject({ version: "1.2.0" });
    expect(parseArguments(["update", "latest"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["sync"])).toEqual({ command: "sync", home: undefined });
    expect(parseArguments(["hub"])).toEqual({ command: "hub", home: undefined });
    expect(parseArguments(["link"])).toEqual({ command: "link", home: undefined });
    expect(parseArguments(["settings"])).toEqual({ command: "settings", home: undefined, action: "list" });
    expect(parseArguments(["settings", "get", "updates.frequency"])).toEqual({
      command: "settings",
      home: undefined,
      action: "get",
      key: "updates.frequency",
    });
    expect(parseArguments(["settings", "set", "timeZone", "Europe/Madrid"])).toEqual({
      command: "settings",
      home: undefined,
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
    expect(parseArguments(["--home"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["help"])).toEqual({ command: "help", home: undefined });
  });
});

describe("runDoctor", () => {
  const doctorBasics = {
    standalone: false,
    platform: "win32",
    userName: "person",
    defaultEngine: "claude-code",
  } as const satisfies Partial<DoctorOptions>;

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

  function finding(programs: readonly string[]): ProcessRunner {
    return {
      run: (command) =>
        programs.includes(command[0] ?? "")
          ? Promise.resolve({ exitCode: 0, stdout: "v1\n", stderr: "" })
          : Promise.reject(new Error("not found")),
    };
  }

  test("the default engine's program is required, and the Linux hint gives the install command", async () => {
    const lines: string[] = [];
    const runner = finding(["git", "bun"]);
    const write = (line: string): number => lines.push(line);
    expect(await runDoctor({ ...doctorBasics, runner, environment: {}, write, platform: "linux" })).toBe(false);
    expect(lines.join("\n")).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(lines.indexOf("Optional:")).toBeGreaterThan(lines.findIndex((line) => line.includes("missing claude")));
    expect(await runDoctor({ ...doctorBasics, runner, environment: {}, write, defaultEngine: "pi" })).toBe(false);
    const withPi = finding(["git", "bun", "pi"]);
    expect(await runDoctor({ ...doctorBasics, runner: withPi, environment: {}, write, defaultEngine: "pi" })).toBe(
      true,
    );
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
  let home: string;
  let existingVault: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "eva-setup-"));
    existingVault = join(home, "existing-vault");
    mkdirSync(existingVault);
    writeFileSync(join(existingVault, "AGENTS.md"), "# Vault\n");
  }, gitHookTimeoutMs);
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  }, gitHookTimeoutMs);

  const okRunner: ProcessRunner = { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) };

  async function setup(
    answers: Partial<Record<SetupQuestion, string | string[]>>,
    extra: {
      interactive?: boolean;
      runner?: ProcessRunner;
      lines?: string[];
      asked?: SetupQuestion[];
      defaultHome?: string;
      githubLogin?: SetupOptions["githubLogin"];
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
      defaultHome: extra.defaultHome ?? home,
      githubLogin: extra.githubLogin ?? null,
      platform: "linux",
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
    expect(loadSecrets(homePaths(home))).toMatchObject({
      googleOauthClientId: "client-id",
      googleOauthClientSecret: "client-secret",
    });
  });

  test("without a Google account, the OAuth client is not asked", async () => {
    await setup({ googleClientId: "client-id" });
    expect(loadSecrets(homePaths(home)).googleOauthClientId).toBeUndefined();
  });

  test("the default engine can change; a wrong one is refused", async () => {
    await setup({ engine: "pi" });
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("pi");
    const lines: string[] = [];
    await setup({ engine: "codex" }, { lines });
    expect(loadSettings(homePaths(home)).config.engines.default).toBe("pi");
    expect(lines.join("\n")).toContain("must be claude-code or pi");
    let caught: unknown;
    try {
      await setup({ engine: "codex" }, { interactive: false });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
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

  test("Eva clones the vault from its repository into her home, with the GitHub token", async () => {
    const remote = createGitSandbox();
    try {
      const commands: { command: string[]; token: string | undefined }[] = [];
      const recording: ProcessRunner = {
        run: (command, options) => {
          commands.push({ command: [...command], token: options.environment["EVA_GITHUB_TOKEN"] });
          return systemProcessRunner.run(command, options);
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
    } finally {
      remote.dispose();
    }
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
        { runner: systemProcessRunner, lines },
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
      await setup({ vaultRepository: missing }, { interactive: false, runner: systemProcessRunner });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
    expect(String(caught)).toContain(`git could not read ${missing}`);
  });

  describe("the GitHub login", () => {
    const githubVault = "https://github.com/example/vault";
    const tokenRunner = (tokens: (string | undefined)[]): ProcessRunner => ({
      run: (_command, options) => {
        tokens.push(options.environment["EVA_GITHUB_TOKEN"]);
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

    test("a script and another host get the token question, never the login", async () => {
      const logins: string[] = [];
      const githubLogin = browserLogin(logins);
      const lines: string[] = [];
      await setup({ githubToken: "", vaultRepository: githubVault }, { interactive: false, githubLogin, lines });
      rmSync(join(home, "vault"), { recursive: true, force: true });
      await setup(
        { vaultRepository: "https://git.example.com/you/vault", githubToken: "a-pasted-token" },
        { githubLogin, lines },
      );
      expect(lines.join("\n")).not.toContain("The login lets Eva");
      expect(logins).toEqual([]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("a-pasted-token");
    });

    test("a github.com SSH address offers the login for private projects, with Enter to skip", async () => {
      const logins: string[] = [];
      const githubLogin = browserLogin(logins);
      const lines: string[] = [];
      await setup({ vaultRepository: "git@github.com:example/vault.git" }, { githubLogin, lines });
      expect(lines.join("\n")).toContain("The login lets Eva");
      expect(logins).toEqual([]);
      await setup({ vaultRepository: "ssh://git@github.com/example/vault.git", githubToken: "login" }, { githubLogin });
      expect(logins).toEqual(["login"]);
    });

    test("with no address, as in a rerun or for a new vault, Enter skips the login and login starts it", async () => {
      const logins: string[] = [];
      const githubLogin = browserLogin(logins);
      await setup({}, { githubLogin });
      expect(logins).toEqual([]);
      await setup({ githubToken: "login" }, { githubLogin });
      expect(logins).toEqual(["login"]);
      expect(loadSecrets(homePaths(home)).githubToken).toBe("gho_browser_token_1");
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

  test("a Telegram chat id skips the pairing code; a wrong one is refused", async () => {
    await setup({ telegramToken: "123456:telegram-token-value", telegramChatId: "-100123" });
    expect(loadSettings(homePaths(home)).config.telegram.allowedChatId).toBe(-100123);
    const lines: string[] = [];
    await setup({ telegramChatId: "my chat" }, { lines });
    expect(lines.join("\n")).toContain("whole number");
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

  test("an empty vault folder can become a new vault from the template, with a private GitHub repository", async () => {
    const commands: string[][] = [];
    const recordingRunner: ProcessRunner = {
      run: (command, options) => {
        commands.push([...command]);
        return systemProcessRunner.run(command[0] === "gh" ? ["git", "--version"] : command, options);
      },
    };
    const lines: string[] = [];
    const newVault = join(home, "new-vault");
    await setup(
      { vault: newVault, createVault: "yes", name: "Alex", topics: "Work, music", githubRepository: "my-vault" },
      { runner: recordingRunner, lines },
    );
    const assistant = readFileSync(join(newVault, ".eva", "assistant.md"), "utf8");
    expect(assistant).toContain("- **Name:** Alex");
    expect(assistant).toContain("- Work\n- music\n");
    expect(commands.find((command) => command[0] === "gh")).toEqual([
      "gh",
      "repo",
      "create",
      "my-vault",
      "--private",
      "--source",
      newVault,
      "--remote",
      "origin",
      "--push",
    ]);
    expect(lines.join("\n")).toContain("Created the private repository my-vault");
  });

  test("a refused new vault leaves the folder empty, and a failed gh call says what to do", async () => {
    const emptyFolder = join(home, "empty");
    await setup({ vault: emptyFolder, createVault: "no" });
    expect(existsSync(join(emptyFolder, "AGENTS.md"))).toBe(false);
    const ghEnvironments: Readonly<Record<string, string>>[] = [];
    const ghFails: ProcessRunner = {
      run: (command, options) => {
        if (command[0] !== "gh") return systemProcessRunner.run(command, options);
        ghEnvironments.push(options.environment);
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "not logged in" });
      },
    };
    const lines: string[] = [];
    await setup({ vault: emptyFolder, createVault: "y", githubRepository: "my-vault" }, { runner: ghFails, lines });
    expect(lines.join("\n")).toContain("gh could not create the repository: not logged in. Run `gh auth login`");
    // The first instance uses the OS user's own gh login.
    expect(ghEnvironments[0]?.["GH_CONFIG_DIR"]).toBeUndefined();
  });

  test("an extra instance hears about its own engine logins first, and gets a login report at the end", async () => {
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
      { lines, runner, defaultHome: join(home, "..", "default-eva-home") },
    );
    const ghFolder = join(home, "engines", "gh");
    const firstStep = lines.findIndex((line) => line.includes("second Eva on this computer"));
    expect(firstStep).toBeGreaterThan(-1);
    expect(firstStep).toBeLessThan(lines.findIndex((line) => line.startsWith("Created a new vault")));
    expect(lines.join("\n")).toContain(`GH_CONFIG_DIR='${ghFolder}' gh auth login --insecure-storage`);
    expect(lines.join("\n")).toContain(`gh could not create the repository: not logged in. Run \`GH_CONFIG_DIR=`);
    // gh repo create and the login check both use this instance's gh folder.
    expect(ghEnvironments.length).toBeGreaterThan(0);
    expect(ghEnvironments.every((environment) => environment["GH_CONFIG_DIR"] === ghFolder)).toBe(true);
    expect(lines.join("\n")).toContain("- Claude: token saved.");
    expect(lines.join("\n")).toContain("- GitHub: not logged in.");
  });

  test("a missing Claude token names how to run setup again: this home for a person, the variable for a script", async () => {
    const extraHome = { defaultHome: join(home, "..", "default-eva-home") };
    const lines: string[] = [];
    await setup({}, { lines, ...extraHome });
    expect(lines.join("\n")).toContain(`run \`eva --home '${home}' setup\` again`);
    const scriptLines: string[] = [];
    await setup({}, { lines: scriptLines, interactive: false, ...extraHome });
    expect(scriptLines.join("\n")).not.toContain("Setup keeps going");
    expect(scriptLines.join("\n")).toContain("run setup again with the token in EVA_CLAUDE_TOKEN");
  });

  test("the instance in the default home hears nothing about engine logins", async () => {
    const lines: string[] = [];
    await setup({}, { lines });
    expect(lines.join("\n")).not.toContain("second Eva");
    expect(lines.join("\n")).not.toContain("Engine logins");
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
      home: "/srv/eva-home",
      path: "/usr/bin:/bin",
    });
    expect(unit).toContain("ExecStart=/usr/bin/bun /opt/eva/src/main.ts --home /srv/eva-home");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartPreventExitStatus=2 3");
    expect(unit).toContain("Environment=PATH=/usr/bin:/bin");
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

  test("a second instance on the same machine gets its own service name", () => {
    expect(serviceName("/u/.config/eva", "/u/.config/eva")).toBe("eva");
    expect(serviceName("/u/.config/eva-partner", "/u/.config/eva")).toBe("eva-eva-partner");
    expect(serviceName("/srv/Partner Home", "/u/.config/eva")).toBe("eva-partner-home");
    expect(serviceName("/srv/__", "/u/.config/eva")).toBe("eva-instance");
    // The same default-home test as the engine logins: Windows ignores letter case.
    expect(serviceName("D:\\Eva-Homes\\EVA", "d:\\eva-homes\\eva\\", "win32")).toBe("eva");
    expect(windowsTaskCommand({ executable: ["eva.exe"], home: "C:/h" }, "eva-partner")).toContain("Eva-partner");
  });

  test("the Windows task starts the Eva supervisor at logon, which restarts her after a crash", () => {
    expect(windowsTaskCommand({ executable: ["C:/bun/bun.exe", "C:/eva/src/main.ts"], home: "C:/home/eva" })).toEqual([
      "schtasks",
      "/Create",
      "/F",
      "/SC",
      "ONLOGON",
      "/TN",
      "Eva",
      "/TR",
      '"C:/bun/bun.exe" "C:/eva/src/main.ts" supervise --home "C:/home/eva"',
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
    expect(windowsTaskSettingsCommand()[4]).toContain("-TaskName 'Eva'");
  });

  test("after the install, the Windows task starts at once, under the same name", () => {
    expect(windowsRunTaskCommand()).toEqual(["schtasks", "/Run", "/TN", "Eva"]);
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
        { version: "2.0.0", notes: "", level: "major" as const, summary: "Breaking changes:\n• feat!: x (2.0.0)" },
        { version: "1.3.0", notes: "", level: "minor" as const, summary: "New features:\n• feat: y (1.3.0)" },
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
  };

  test("starts with All good when nothing is wrong", () => {
    expect(describeStatusLines(status).slice(0, 2)).toEqual(["All good", "Eva 1.2.3, hub: this machine (server)"]);
  });

  test("starts with the number of problems, then one line for each problem", () => {
    const lines = describeStatusLines({ ...status, problems: ["The vault sync failed.", "The update failed."] });
    expect(lines.slice(0, 3)).toEqual(["2 problems", "• The vault sync failed.", "• The update failed."]);
    expect(describeStatusLines({ ...status, problems: ["The vault sync failed."] })[0]).toBe("1 problem");
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
  test("shows the phone address, the reason there is none, or nothing without Tailscale", () => {
    expect(describeRemoteAccess(null)).toEqual([]);
    expect(describeRemoteAccess({ url: "https://server.example-tailnet.ts.net", problem: null })).toEqual([
      "Phone access: https://server.example-tailnet.ts.net",
    ]);
    expect(describeRemoteAccess({ url: null, problem: "Turn on HTTPS" })).toEqual(["Phone access: Turn on HTTPS"]);
    expect(describeRemoteAccess({ url: null, problem: null })).toEqual(["Phone access: not available"]);
  });
});
