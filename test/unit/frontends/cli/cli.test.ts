import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths, loadConfig, loadSecrets } from "../../../../src/core/instance/home.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { parseArguments } from "../../../../src/frontends/cli/arguments.ts";
import { runChat } from "../../../../src/frontends/cli/chat.ts";
import {
  describeProjects,
  describeStatus,
  heldBackLines,
  startProjectWork,
} from "../../../../src/frontends/cli/client.ts";
import { runDoctor } from "../../../../src/frontends/cli/doctor.ts";
import { systemdUnit, windowsTaskCommand } from "../../../../src/frontends/cli/service.ts";
import {
  firstFreePort,
  runSetup,
  setupEnvironmentNames,
  type SetupQuestion,
} from "../../../../src/frontends/cli/setup.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
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
  });

  test("an unknown command or a bad option is a usage error", () => {
    expect(parseArguments(["fly"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["chat", "--model", "giant"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["--home"])).toMatchObject({ command: "usage-error" });
    expect(parseArguments(["help"])).toEqual({ command: "help", home: undefined });
  });
});

describe("runDoctor", () => {
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
      runner,
      environment: { PATH: "/bin" },
      write: (line) => lines.push(line),
      standalone: false,
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
    expect(await runDoctor({ runner, environment: {}, write: () => undefined, standalone: false })).toBe(false);
  });

  test("the single executable carries its own Bun, so bun is not checked", async () => {
    const asked: string[] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        asked.push(command[0] ?? "");
        return Promise.resolve({ exitCode: 0, stdout: "v1\n", stderr: "" });
      },
    };
    expect(await runDoctor({ runner, environment: {}, write: () => undefined, standalone: true })).toBe(true);
    expect(asked).not.toContain("bun");
    expect(asked).toContain("git");
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
    extra: { interactive?: boolean; runner?: ProcessRunner; lines?: string[] } = {},
  ): Promise<void> {
    const queues = Object.fromEntries(
      Object.entries(answers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]),
    ) as Partial<Record<SetupQuestion, string[]>>;
    await runSetup({
      paths: homePaths(home),
      ask: (key) => Promise.resolve(queues[key]?.shift() ?? ""),
      write: (line) => extra.lines?.push(line),
      newToken: () => "generated-token",
      interactive: extra.interactive ?? true,
      runner: extra.runner ?? okRunner,
      environment: gitEnvironment,
    });
  }

  test("writes the answers to the config and the secrets, and creates the local API token", async () => {
    await setup({ vault: existingVault, timeZone: "Europe/Madrid", port: "7421", trustedOwners: "owner, other" });
    expect(loadConfig(homePaths(home))).toMatchObject({
      vaultPath: existingVault,
      timeZone: "Europe/Madrid",
      port: 7421,
      trust: { trustedRepositoryOwners: ["owner", "other"] },
    });
    expect(loadSecrets(homePaths(home))).toEqual({ localApiToken: "generated-token" });
  });

  test("an empty answer keeps the current value, and a Claude token is stored as a secret", async () => {
    await setup({ claudeToken: "a-claude-setup-token-value" });
    expect(loadConfig(homePaths(home)).port).toBe(defaultConfig.port);
    expect(loadSecrets(homePaths(home)).claudeOauthToken).toBe("a-claude-setup-token-value");
  });

  test("a Telegram token turns Telegram on", async () => {
    await setup({ telegramToken: "123456:telegram-token-value" });
    expect(loadConfig(homePaths(home)).telegram.enabled).toBe(true);
    expect(loadSecrets(homePaths(home)).telegramBotToken).toBe("123456:telegram-token-value");
  });

  test("Google and voice answers reach the config and the secrets", async () => {
    await setup({
      googleEmail: "person@example.com",
      googleClientId: "client-id",
      googleClientSecret: "client-secret",
      voiceModel: "/models/ggml-base.bin",
    });
    const config = loadConfig(homePaths(home));
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
    expect(loadConfig(homePaths(home)).engines.default).toBe("pi");
    const lines: string[] = [];
    await setup({ engine: "codex" }, { lines });
    expect(loadConfig(homePaths(home)).engines.default).toBe("pi");
    expect(lines.join("\n")).toContain("must be claude-code or pi");
    let caught: unknown;
    try {
      await setup({ engine: "codex" }, { interactive: false });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
  });

  test("a port that another program uses is not suggested (plan §4.4)", async () => {
    const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    try {
      const port = taken.port ?? 0;
      expect(await firstFreePort(port)).toBeGreaterThan(port);
      expect(await firstFreePort(port + 1)).toBeGreaterThan(port);
    } finally {
      await taken.stop(true);
    }
  });

  test("a bad port is asked again", async () => {
    const lines: string[] = [];
    await setup({ port: ["high", "7500"] }, { lines });
    expect(loadConfig(homePaths(home)).port).toBe(7500);
    expect(lines.join("\n")).toContain("1024 to 65535");
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
      { vault: newVault, createVault: "yes", name: "Alex", githubRepository: "my-vault" },
      { runner: recordingRunner, lines },
    );
    expect(readFileSync(join(newVault, ".eva", "assistant.md"), "utf8")).toContain("Alex");
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
    const ghFails: ProcessRunner = {
      run: (command, options) =>
        command[0] === "gh"
          ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "not logged in" })
          : systemProcessRunner.run(command, options),
    };
    const lines: string[] = [];
    await setup({ vault: emptyFolder, createVault: "y", githubRepository: "my-vault" }, { runner: ghFails, lines });
    expect(lines.join("\n")).toContain("gh could not create the repository: not logged in");
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

  test("the Windows task starts Eva at logon", () => {
    expect(windowsTaskCommand({ executable: ["C:/bun/bun.exe", "C:/eva/src/main.ts"], home: "C:/home/eva" })).toEqual([
      "schtasks",
      "/Create",
      "/F",
      "/SC",
      "ONLOGON",
      "/TN",
      "Eva",
      "/TR",
      '"C:/bun/bun.exe" "C:/eva/src/main.ts" --home "C:/home/eva"',
    ]);
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

  test("status and projects print short text", async () => {
    const before = await describeStatus({ baseUrl: api.url, token: "chat-token" });
    expect(before).toContain("Vault sync: ok");
    expect(before).toMatch(/^Eva \d+\.\d+\.\d+, role: hub/);
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

  test("an approval is asked in the terminal, with y or n (plan §5.5)", async () => {
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
  test("names the files that the secret scan keeps out, and says nothing when there are none", () => {
    expect(heldBackLines([])).toEqual([]);
    expect(heldBackLines(["Notes/keys.md", ".env"])).toEqual([
      "Held back from the vault, as they look like secrets: Notes/keys.md, .env",
    ]);
  });
});
