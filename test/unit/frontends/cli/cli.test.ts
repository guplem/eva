import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths, loadConfig, loadSecrets } from "../../../../src/core/instance/home.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { parseArguments } from "../../../../src/frontends/cli/arguments.ts";
import { runChat } from "../../../../src/frontends/cli/chat.ts";
import { describeProjects, describeStatus } from "../../../../src/frontends/cli/client.ts";
import { runDoctor } from "../../../../src/frontends/cli/doctor.ts";
import { systemdUnit, windowsTaskCommand } from "../../../../src/frontends/cli/service.ts";
import { runSetup } from "../../../../src/frontends/cli/setup.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, type GitSandbox } from "../../../support/git-sandbox.ts";

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
    expect(parseArguments(["setup"])).toEqual({ command: "setup", home: undefined });
    expect(parseArguments(["doctor"])).toEqual({ command: "doctor", home: undefined });
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
    const healthy = await runDoctor({ runner, environment: { PATH: "/bin" }, write: (line) => lines.push(line) });
    expect(healthy).toBe(true);
    expect(lines.join("\n")).toContain("ok      git: git version 2.50.0");
    expect(lines.join("\n")).toContain("missing gh");
    expect(lines.join("\n")).toContain("Optional:");
  });

  test("a missing required tool fails the check", async () => {
    const runner: ProcessRunner = { run: () => Promise.reject(new Error("not found")) };
    expect(await runDoctor({ runner, environment: {}, write: () => undefined })).toBe(false);
  });
});

describe("runSetup", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "eva-setup-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("writes the answers to the config and the secrets, and creates the local API token", async () => {
    const answers = ["/vault", "Europe/Madrid", "7421", "owner", "", ""];
    await runSetup({
      paths: homePaths(home),
      ask: () => Promise.resolve(answers.shift() ?? ""),
      write: () => undefined,
      newToken: () => "generated-token",
    });
    expect(loadConfig(homePaths(home))).toMatchObject({
      vaultPath: "/vault",
      timeZone: "Europe/Madrid",
      port: 7421,
      trust: { trustedRepositoryOwners: ["owner"] },
    });
    expect(loadSecrets(homePaths(home))).toEqual({ localApiToken: "generated-token" });
  });

  test("an empty answer keeps the current value, and a Claude token is stored as a secret", async () => {
    const answers = ["", "", "", "", "a-claude-setup-token-value", ""];
    await runSetup({
      paths: homePaths(home),
      ask: () => Promise.resolve(answers.shift() ?? ""),
      write: () => undefined,
      newToken: () => "t",
    });
    expect(loadConfig(homePaths(home)).port).toBe(defaultConfig.port);
    expect(loadSecrets(homePaths(home)).claudeOauthToken).toBe("a-claude-setup-token-value");
  });

  test("a bad port is asked again", async () => {
    const answers = ["", "", "high", "7500", "", "", ""];
    const lines: string[] = [];
    await runSetup({
      paths: homePaths(home),
      ask: () => Promise.resolve(answers.shift() ?? ""),
      write: (line) => lines.push(line),
      newToken: () => "t",
    });
    expect(loadConfig(homePaths(home)).port).toBe(7500);
    expect(lines.join("\n")).toContain("1024 to 65535");
  });
});

describe("service", () => {
  test("the systemd unit restarts on a crash, never on bad settings or a second instance (lesson 89)", () => {
    const unit = systemdUnit({
      executable: ["/usr/bin/bun", "/opt/eva/src/main.ts"],
      home: "/home/demo/.config/eva",
      path: "/usr/bin:/bin",
    });
    expect(unit).toContain("ExecStart=/usr/bin/bun /opt/eva/src/main.ts --home /home/demo/.config/eva");
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

  beforeEach(() => {
    sandbox = createGitSandbox();
    const vault = sandbox.clone("vault");
    sandbox.write(vault, ".eva/assistant.md", "# You are Eva\n");
    sandbox.git(vault, "add", "-A");
    sandbox.git(vault, "commit", "-q", "-m", "eva");
    sandbox.git(vault, "push", "-q", "origin", "main");
    home = mkdtempSync(join(tmpdir(), "eva-chat-"));
    eva = new Eva({
      paths: homePaths(home),
      config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC" },
      secrets: {},
      engines: [new FakeEngine((request) => FakeEngine.answer(request, "Hi! I am Eva."))],
      runner: { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) },
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
      gatherMs: 5,
    });
    api = startLocalApi({ eva, port: 0, token: "chat-token", extraHosts: [], allowedTailscaleIdentities: [] });
  });
  afterEach(() => {
    api.stop();
    eva.stop();
    sandbox.dispose();
    rmSync(home, { recursive: true, force: true });
  });

  test("status and projects print short text", async () => {
    expect(await describeStatus({ baseUrl: api.url, token: "chat-token" })).toContain("Vault sync: ok");
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
});
