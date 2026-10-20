import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { readHubClaim } from "../../../../src/core/instance/hub.ts";
import { acquireInstanceLock } from "../../../../src/core/instance/instance-lock.ts";
import {
  createHomeFolders,
  defaultConfig,
  homePaths,
  instanceHome,
  loadSecrets,
  saveConfig,
  saveSecrets,
  type EvaConfig,
  type HomePaths,
} from "../../../../src/core/settings/home.ts";
import { loadSettings } from "../../../../src/core/settings/settings.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { describeFailure, runCli, type CliWiring } from "../../../../src/frontends/cli/commands.ts";
import { terminalDeviceApprover } from "../../../../src/frontends/cli/devices.ts";
import { evaCommand } from "../../../../src/frontends/cli/host.ts";
import { updateChannel } from "../../../../src/frontends/cli/local-commands.ts";
import { restartMethodNow } from "../../../../src/frontends/cli/service.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import { exitCodes } from "../../../../src/shared/exit-codes.ts";
import type { LongProcessStarter } from "../../../../src/shared/long-process.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { fakeHost, scriptedRunner, type FakeHost } from "../../../support/fake-host.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

let root: string;
let paths: HomePaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-commands-"));
  paths = homePaths(instanceHome(root, "test"));
  createHomeFolders(paths);
  // Setup writes the config, so a home without one is no Eva.
  writeFileSync(paths.config, "{}\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const noWiring: CliWiring = {
  serve: () => Promise.reject(new Error("serve is not part of this test")),
  startLongProcess: () => {
    throw new Error("no long process in this test");
  },
};

function run(host: FakeHost, ...argv: string[]): Promise<number> {
  return runCli(["--instance", "test", ...argv], inRoot(host), noWiring);
}

/** The host with the test folder as its config folder, where the instances live. */
function inRoot<Host extends FakeHost>(host: Host): Host {
  return { ...host, environment: { ...host.environment, XDG_CONFIG_HOME: root, APPDATA: root } };
}

function printed(host: FakeHost): string {
  return host.output.join("");
}

describe("runCli without a home", () => {
  test("help, version and a usage error need no home", async () => {
    const host = fakeHost();
    expect(await runCli(["help"], host, noWiring)).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Usage: eva");
    expect(await runCli(["version"], host, noWiring)).toBe(exitCodes.clean);
    expect(await runCli(["fly"], host, noWiring)).toBe(exitCodes.badConfig);
    expect(host.errors.join("")).toContain("Unknown command fly.");
  });

  test("run starts the whole Eva through the wiring, in the home of the only Eva", async () => {
    const served: string[] = [];
    const wiring: CliWiring = {
      ...noWiring,
      serve: (served_paths) => {
        served.push(served_paths.root);
        return Promise.resolve(exitCodes.update);
      },
    };
    expect(await runCli([], inRoot(fakeHost()), wiring)).toBe(exitCodes.update);
    expect(served).toEqual([paths.root]);
  });
});

describe("describeFailure", () => {
  test("maps each error to its exit code; only an unexpected error shows a stack, redacted", () => {
    expect(describeFailure(new EvaError("config_invalid", "Bad config."))).toEqual({
      exitCode: exitCodes.badConfig,
      text: "Bad config.\n",
    });
    expect(describeFailure(new EvaError("instance_locked", "Another Eva runs."))).toEqual({
      exitCode: exitCodes.secondInstance,
      text: "Another Eva runs.\n",
    });
    expect(describeFailure(new EvaError("update_failed", "No update."))).toEqual({
      exitCode: exitCodes.crash,
      text: "No update.\n",
    });
    const crash = describeFailure(new Error("token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked"));
    expect(crash.exitCode).toBe(exitCodes.crash);
    expect(crash.text).toStartWith("Eva stopped on an error: Error: token");
    expect(crash.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(describeFailure("plain").text).toBe("Eva stopped on an error: plain\n");
  });
});

describe("doctor and setup", () => {
  test("doctor passes when each tool answers", async () => {
    const host = fakeHost();
    expect(await run(host, "doctor")).toBe(exitCodes.clean);
    expect(host.commands.some((command) => command[0] === "git")).toBe(true);
  });

  test("doctor shows the Google state, offline when a part is missing", async () => {
    const host = fakeHost();
    expect(await run(host, "doctor")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("off     Google: not set up.");
    saveSecrets(paths, { googleOauthClientId: "client-id", googleOauthClientSecret: "GOCSPX-client-secret-value" });
    const withClient = fakeHost();
    expect(await run(withClient, "doctor")).toBe(exitCodes.clean);
    expect(printed(withClient)).toContain("failed  Google: No Google account is logged in.");
  });

  test("doctor fails when a required tool is missing", async () => {
    const host = fakeHost({ runner: scriptedRunner([], () => ({ exitCode: 1 })) });
    expect(await run(host, "doctor")).toBe(exitCodes.crash);
  });

  test("a non-interactive setup reads its answers from EVA_* variables", async () => {
    const host = fakeHost({ environment: { ...gitEnvironment, EVA_PORT: "7421" } });
    expect(await run(host, "setup", "--non-interactive")).toBe(exitCodes.clean);
    expect(loadSettings(paths).config.port).toBe(7421);
    expect(loadSecrets(paths).localApiToken).toBeString();
  });

  test("an interactive setup asks at the console, and starts Eva as a service", async () => {
    // Enter at the GitHub question would start a real browser login, so this person skips it.
    const host = fakeHost({
      userHome: join(root, "user"),
      withPrompt: (work) => work((question) => Promise.resolve(question.startsWith("GitHub login") ? "skip" : "")),
    });
    expect(await run(host, "setup")).toBe(exitCodes.clean);
    expect(loadSecrets(paths).localApiToken).toBeString();
    expect(host.commands).toContainEqual(["systemctl", "--user", "enable", "--now", "eva-test.service"]);
    // The fake runs no real Eva, so she never answers, and setup goes on.
    expect(printed(host)).toContain("Eva did not start.");
  });
});

describe("the client commands", () => {
  test("devices allow needs a running Eva, which holds the waiting devices", async () => {
    const host = fakeHost();
    expect(await run(host, "devices", "allow", "AB2C")).toBe(exitCodes.badConfig);
    expect(host.errors.join("")).toContain("Eva does not run");
  });

  test("need the local token from setup", async () => {
    const host = fakeHost();
    expect(await run(host, "status")).toBe(exitCodes.badConfig);
    expect(host.errors.join("")).toContain("Run `eva setup` first.");
  });

  test("say that Eva may not run when the API does not answer", async () => {
    saveSecrets(paths, { localApiToken: "token" });
    saveConfig(paths, { ...defaultConfig, port: 1025 });
    const host = fakeHost();
    expect(await run(host, "projects")).toBe(exitCodes.crash);
    expect(host.errors.join("")).toContain("Is Eva running?");
  });
});

describe("with a running Eva", () => {
  let sandbox: GitSandbox;
  let eva: Eva;
  let api: LocalApi;
  let host: FakeHost;

  beforeEach(() => {
    sandbox = createGitSandbox();
    const config: EvaConfig = { ...defaultConfig, vaultPath: sandbox.clone("vault"), machineName: "server" };
    eva = new Eva({
      paths,
      config,
      secrets: { localApiToken: "running-token" },
      engines: [],
      runner: systemProcessRunner,
      processEnvironment: gitEnvironment,
      now: () => new Date(),
      basePrompt: "Base.",
    });
    api = startLocalApi({ eva, port: 0, token: "running-token", extraHosts: [], allowedTailscaleIdentities: [] });
    saveConfig(paths, { ...config, port: Number(new URL(api.url).port) });
    saveSecrets(paths, { localApiToken: "running-token" });
    // This process holds the lock, so setup, which asks the real system, sees Eva run and keeps her port.
    acquireInstanceLock(paths.lock, { pid: process.pid, bootId: null, isProcessAlive: () => false });
    host = fakeHost({ isProcessAlive: () => true });
  }, gitHookTimeoutMs);
  afterEach(async () => {
    api.stop();
    await eva.idle();
    eva.stop();
    sandbox.dispose();
  }, gitHookTimeoutMs);

  test("status, projects and work go to the running Eva", async () => {
    expect(await run(host, "status")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Vault sync");
    expect(await run(host, "projects")).toBe(exitCodes.clean);
    expect(await run(host, "work", "missing-project", "do it")).toBe(exitCodes.crash);
  });

  test("chat talks to the running Eva until the input ends", async () => {
    const chatting = fakeHost({ isProcessAlive: () => true }, ["/exit"]);
    expect(await run(chatting, "chat")).toBe(exitCodes.clean);
  });

  test("sync, hub, link and update go to the running Eva", async () => {
    expect(await run(host, "sync")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Vault sync:");
    expect(await run(host, "hub")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("server is now the hub.");
    expect(await run(host, "link")).toBe(exitCodes.clean);
    // The running Eva has no update channel here; main.ts turns the error into exit code 1.
    const failure = await run(host, "update", "--check").then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("no update channel");
  });

  test("setup restarts a running Eva when it changed her files, so she uses the new answers", async () => {
    const answering = fakeHost({
      isProcessAlive: () => true,
      environment: { ...gitEnvironment, EVA_TIME_ZONE: "Pacific/Auckland" },
    });
    expect(await run(answering, "setup", "--non-interactive")).toBe(exitCodes.clean);
    expect(printed(answering)).toContain("Restarting Eva, so she uses the new answers.");
    // The same list as on the page, before the restart takes the page away.
    expect(printed(answering)).toContain("Setup progress:");
    // Phone access is off in this test, so a device is optional.
    expect(printed(answering)).toContain("○ Your devices: Open Eva's page on your phone.");
  });

  test("a page that does not answer at the end never fails a setup that saved every answer", async () => {
    // The lock says Eva runs, but nothing listens on this port, such as after a slow start. A fixed
    // port could belong to a server of a parallel test file, so the test takes a port that it freed.
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = probe.port ?? 0;
    await probe.stop(true);
    saveConfig(paths, { ...loadSettings(paths).config, port });
    const answering = fakeHost({
      isProcessAlive: () => true,
      environment: { ...gitEnvironment, EVA_TIME_ZONE: "Pacific/Auckland", EVA_PORT: String(port) },
    });
    expect(await run(answering, "setup", "--non-interactive")).toBe(exitCodes.clean);
    expect(printed(answering)).toContain("Eva's page did not answer.");
  });

  test("devices allow lets in the browser that shows the code, and never prints its token", async () => {
    eva.deviceLogins.attachApprover(terminalDeviceApprover);
    const request = eva.deviceLogins.request("this computer", "this computer, a browser");
    expect(request.approvers).toEqual(["terminal"]);
    expect(await run(host, "devices", "allow", "ZZZZ")).toBe(exitCodes.badConfig);
    expect(host.errors.join("")).toContain("No device waits with this code.");
    expect(await run(host, "devices", "allow", request.code.toLowerCase())).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Allowed this computer, a browser.");
    const answer = eva.deviceLogins.check(request.id, "this computer");
    expect(answer.state).toBe("allowed");
    expect(printed(host)).not.toContain(answer.state === "allowed" ? answer.token : "no token");
  });

  test("a setting changes through the running Eva, which says whether it needs a restart", async () => {
    expect(await run(host, "settings", "set", "updates.frequency", "weekly")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Saved updates.frequency in the vault, for every machine. Eva uses it now.");
    expect(await run(host, "settings", "set", "port", "7425")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Saved port on this machine. Restart Eva to use it.");
  });
});

describe("with no Eva running", () => {
  test("link needs the running Eva", async () => {
    const host = fakeHost();
    expect(await run(host, "link")).toBe(exitCodes.crash);
    expect(printed(host)).toContain("Eva is not running");
  });

  test("sync and hub need no vault for their answer", async () => {
    const host = fakeHost();
    expect(await run(host, "sync")).toBe(exitCodes.badConfig);
    expect(await run(host, "hub")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Without a vault, this machine is always the hub.");
  });

  test("sync and hub work on the vault here", async () => {
    const sandbox = createGitSandbox();
    try {
      const vault = sandbox.clone("vault");
      saveConfig(paths, { ...defaultConfig, vaultPath: vault });
      const host = fakeHost({ runner: systemProcessRunner });
      sandbox.write(vault, "note.md", "A note.\n");
      expect(await run(host, "sync")).toBe(exitCodes.clean);
      expect(printed(host)).toContain("Vault sync: ok");
      expect(await run(host, "hub")).toBe(exitCodes.clean);
      expect(readHubClaim(vault)?.machine).toBe("server");
      saveConfig(paths, { ...defaultConfig, vaultPath: join(root, "missing-vault") });
      expect(await run(host, "sync")).toBe(exitCodes.crash);
    } finally {
      sandbox.dispose();
    }
  });

  test("settings shows, gets and saves a setting here", async () => {
    const host = fakeHost();
    expect(await run(host, "settings")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("port = 7420");
    expect(await run(host, "settings", "get", "port")).toBe(exitCodes.clean);
    expect(await run(host, "settings", "get", "nothing")).toBe(exitCodes.badConfig);
    expect(await run(host, "settings", "set", "port", "7425")).toBe(exitCodes.clean);
    expect(loadSettings(paths).config.port).toBe(7425);
    expect(printed(host)).toContain("Saved port on this machine.");
  });

  test("update checks and installs from the source checkout here", async () => {
    const answers: Record<string, string> = {
      "rev-parse --abbrev-ref HEAD": "main",
      "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
      "rev-list --count HEAD..origin/main": "0",
      "rev-parse --short HEAD": "abc1234",
      "rev-parse --short origin/main": "abc1234",
    };
    const runner = scriptedRunner([], (command) => {
      const key = command.slice(1).join(" ");
      return { stdout: answers[key] ?? "" };
    });
    const host = fakeHost({ runner });
    expect(await run(host, "update", "--check")).toBe(exitCodes.clean);
    expect(printed(host)).toContain("Updates: abc1234 is the latest; checks daily");
  });
});

describe("the host helpers", () => {
  test("the single executable runs itself; a source checkout runs bun with main.ts", () => {
    expect(evaCommand(fakeHost({ standalone: true, execPath: "C:/eva/eva.exe" }))).toEqual(["C:/eva/eva.exe"]);
    expect(evaCommand(fakeHost())).toEqual(["/usr/bin/bun", "/opt/eva/src/main.ts"]);
  });

  test("the restart reads the parent at that moment, so an orphan of a dead supervisor starts a new copy", () => {
    let parent = 4321;
    const host = fakeHost({
      environment: { EVA_SUPERVISED: "4321" },
      isProcessAlive: () => true,
      parentPid: () => parent,
    });
    expect(restartMethodNow(host)).toBe("supervisor");
    // The supervisor died, and another process now has its pid; Eva's new parent is pid 1.
    parent = 1;
    expect(restartMethodNow(host)).toBe("new-copy");
  });
  test("the single executable updates from signed releases, a checkout from git", () => {
    expect(updateChannel(fakeHost({ standalone: true }), {}).kind).toBe("executable");
    expect(updateChannel(fakeHost(), {}).kind).toBe("source");
  });
});

describe("service install and supervise", () => {
  test("on Linux, writes the systemd unit, starts it, and turns linger on", async () => {
    const userHome = join(root, "user");
    const host = fakeHost({ userHome });
    expect(await run(host, "service", "install")).toBe(exitCodes.clean);
    const unit = readFileSync(join(userHome, ".config", "systemd", "user", "eva-test.service"), "utf-8");
    expect(unit).toContain("ExecStart=/usr/bin/bun /opt/eva/src/main.ts --instance test");
    expect(unit).toContain(`Environment=XDG_CONFIG_HOME=${root}`);
    expect(host.commands.map((command) => command.join(" "))).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now eva-test.service",
      "loginctl enable-linger",
    ]);
    expect(printed(host)).toContain("Eva keeps running when you log out.");
  });

  test("on Linux, a failed step stops the install, and a failed linger says what to run", async () => {
    const userHome = join(root, "user");
    const failing = fakeHost({
      userHome,
      runner: scriptedRunner([], (command) => (command[2] === "enable" ? { exitCode: 1, stderr: "no bus" } : {})),
    });
    expect(await run(failing, "service", "install")).toBe(exitCodes.crash);
    expect(printed(failing)).toContain("failed: no bus");
    const noLinger = fakeHost({
      userHome,
      runner: scriptedRunner([], (command) => (command[0] === "loginctl" ? { exitCode: 1, stderr: "denied" } : {})),
    });
    expect(await run(noLinger, "service", "install")).toBe(exitCodes.clean);
    expect(printed(noLinger)).toContain("sudo loginctl enable-linger example");
  });

  test("on Windows, creates and starts the logon task", async () => {
    const host = fakeHost({ platform: "win32" });
    expect(await run(host, "service", "install")).toBe(exitCodes.clean);
    expect(host.commands.map((command) => command[0])).toEqual(["schtasks", "powershell.exe", "schtasks"]);
    expect(printed(host)).toContain("Eva now starts when you log in, and she runs now.");
  });

  test("on Windows, a refused task names Run as administrator, and a running Eva keeps running", async () => {
    const refused = fakeHost({
      platform: "win32",
      runner: scriptedRunner([], (command) => (command[0] === "schtasks" ? { exitCode: 1, stderr: "denied" } : {})),
    });
    expect(await run(refused, "service", "install")).toBe(exitCodes.crash);
    expect(printed(refused)).toContain("Run as administrator");
    acquireInstanceLock(paths.lock, { pid: 999_999, bootId: null, isProcessAlive: () => false });
    const running = fakeHost({
      platform: "win32",
      isProcessAlive: () => true,
      runner: scriptedRunner([], (command) => (command[0] === "powershell.exe" ? { exitCode: 1, stderr: "no" } : {})),
    });
    expect(await run(running, "service", "install")).toBe(exitCodes.clean);
    expect(printed(running)).toContain("Windows may stop Eva after three days");
    expect(printed(running)).toContain("She already runs");
    rmSync(paths.lock, { force: true });
    const notStarted = fakeHost({
      platform: "win32",
      runner: scriptedRunner([], (command) => (command[1] === "/Run" ? { exitCode: 1, stderr: "busy" } : {})),
    });
    expect(await run(notStarted, "service", "install")).toBe(exitCodes.clean);
    expect(printed(notStarted)).toContain("She did not start now: busy");
  });

  test("supervise runs Eva with this home, and a stop signal ends it", async () => {
    const started: string[][] = [];
    let exit: (code: number) => void = () => undefined;
    const start: LongProcessStarter = (command) => {
      started.push([...command]);
      return {
        exited: new Promise<number>((resolve) => {
          exit = resolve;
        }),
        stop: () => {
          exit(0);
          return Promise.resolve();
        },
      };
    };
    const host = fakeHost();
    const done = runCli(["--instance", "test", "supervise"], inRoot(host), { ...noWiring, startLongProcess: start });
    for (let round = 0; round < 100 && started.length === 0; round += 1) await Bun.sleep(5);
    expect(started[0]).toEqual(["/usr/bin/bun", "/opt/eva/src/main.ts", "--instance", "test"]);
    for (const handler of host.stopHandlers) handler();
    expect(await done).toBe(exitCodes.clean);
  });
});
