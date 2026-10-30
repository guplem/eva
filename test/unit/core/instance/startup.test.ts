import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHubClaim } from "../../../../src/core/instance/hub.ts";
import { prepareStart } from "../../../../src/core/instance/startup.ts";
import {
  createHomeFolders,
  defaultConfig,
  homePaths,
  loadSecrets,
  saveConfig,
  saveSecrets,
  type HomePaths,
} from "../../../../src/core/settings/home.ts";
import { vaultSettingsPath } from "../../../../src/core/settings/settings.ts";
import { systemProcessRunner, type ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

let root: string;
let paths: HomePaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-startup-"));
  paths = homePaths(join(root, "home"));
  createHomeFolders(paths);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function start(runner: ProcessRunner = systemProcessRunner): ReturnType<typeof prepareStart> {
  return prepareStart({
    paths,
    runner,
    processEnvironment: gitEnvironment,
    hostName: "server",
    now: () => new Date("2026-10-18T10:00:00Z"),
    newToken: () => "new-local-token",
  });
}

describe("prepareStart without a vault", () => {
  test("makes the local token once, and keeps it after that", async () => {
    const first = await start();
    expect(first.secrets.localApiToken).toBe("new-local-token");
    expect(loadSecrets(paths).localApiToken).toBe("new-local-token");
    expect(first.notes).toEqual([]);
    saveSecrets(paths, { localApiToken: "kept-token", githubToken: "github-secret" });
    const second = await start();
    expect(second.secrets).toEqual({ localApiToken: "kept-token", githubToken: "github-secret" });
  });

  test("returns the settings as loaded", async () => {
    saveConfig(paths, { ...defaultConfig, port: 7421 });
    expect((await start()).config.port).toBe(7421);
  });
});

describe("prepareStart with a vault", () => {
  let sandbox: GitSandbox;
  let vault: string;

  beforeEach(() => {
    sandbox = createGitSandbox();
    vault = sandbox.clone("vault");
  }, gitHookTimeoutMs);
  afterEach(() => {
    sandbox.dispose();
  });

  /** The settings file of a vault from before the settings folder (#662). The hub moves it at start. */
  function oldSettingsPath(): string {
    return join(vault, ".eva", "settings.json");
  }

  test("claims the hub when no machine has, and says so", async () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    const prepared = await start();
    expect(readHubClaim(vault)?.machine).toBe("server");
    expect(prepared.notes).toContainEqual({
      level: "info",
      message: "No machine was the hub yet, so this machine claimed it.",
    });
  });

  test("pulls first, so a claim that another machine pushed stands", async () => {
    const other = sandbox.clone("other");
    sandbox.write(other, ".eva/hub.json", JSON.stringify({ machine: "laptop", claimedAt: "2026-10-17T10:00:00Z" }));
    sandbox.git(other, "add", "-A");
    sandbox.git(other, "commit", "-q", "-m", "claim");
    sandbox.git(other, "push", "-q");
    saveConfig(paths, { ...defaultConfig, vaultPath: vault, machineName: "server" });
    const prepared = await start();
    expect(readHubClaim(vault)?.machine).toBe("laptop");
    expect(prepared.notes.map((note) => note.message)).not.toContain(
      "No machine was the hub yet, so this machine claimed it.",
    );
  });

  test("claims no hub when the pull failed, so it never claims over a pushed claim", async () => {
    sandbox.git(vault, "remote", "set-url", "origin", join(sandbox.root, "missing.git"));
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    const prepared = await start();
    expect(readHubClaim(vault)).toBeNull();
    expect(prepared.notes.find((note) => note.level === "warn")?.message).toBe(
      "The vault pull could not reach the remote, so this machine did not claim the hub yet.",
    );
  });

  test("claims no hub on a vault that is not on its default branch, and names that cause", async () => {
    sandbox.git(vault, "checkout", "-q", "-b", "side");
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    const prepared = await start();
    expect(readHubClaim(vault)).toBeNull();
    expect(prepared.notes.find((note) => note.level === "warn")?.message).toBe(
      "The vault is not on its default branch, so this machine did not claim the hub yet.",
    );
  });

  test("claims the hub in a vault with no remote, where no other machine can push a claim", async () => {
    sandbox.git(vault, "remote", "remove", "origin");
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    await start();
    expect(readHubClaim(vault)?.machine).toBe("server");
  });

  test("claims no hub when git cannot say whether the vault has a remote", async () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    // The fetch and the remote list fail, as a timeout or a refused folder does.
    const failing: ProcessRunner = {
      run: (command, options) =>
        command.includes("fetch") || command.includes("remote")
          ? Promise.resolve({ exitCode: 128, stdout: "", stderr: "fatal: git failed" })
          : systemProcessRunner.run(command, options),
    };
    await start(failing);
    expect(readHubClaim(vault)).toBeNull();
  });

  test("claims the hub in a vault folder that is not a git repository", async () => {
    const plain = join(root, "plain-vault");
    mkdirSync(plain);
    saveConfig(paths, { ...defaultConfig, vaultPath: plain });
    await start();
    expect(readHubClaim(plain)?.machine).toBe("server");
  });

  test("runs the migrations after the pull: the hub starts the vault's settings file (#119)", async () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid" });
    const prepared = await start();
    expect(prepared.config.timeZone).toBe("Europe/Madrid");
    expect(prepared.migrations.vault).toMatchObject({ kind: "done" });
    expect(JSON.parse(readFileSync(vaultSettingsPath(vault), "utf-8"))).toMatchObject({ timeZone: "Europe/Madrid" });
  });

  test("the hub drops a security setting from the vault (#119)", async () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(oldSettingsPath(), JSON.stringify({ trust: { trustedRepositoryOwners: ["example-owner"] } }));
    await start();
    expect(JSON.parse(readFileSync(vaultSettingsPath(vault), "utf-8"))).not.toHaveProperty("trust");
  });

  test("a satellite runs no vault migration (#119)", async () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(join(vault, ".eva", "hub.json"), JSON.stringify({ machine: "laptop", since: "" }));
    writeFileSync(oldSettingsPath(), JSON.stringify({ trust: { trustedRepositoryOwners: ["example-owner"] } }));
    const prepared = await start();
    expect(prepared.migrations.vault).toBeNull();
    expect(JSON.parse(readFileSync(oldSettingsPath(), "utf-8"))).toHaveProperty("trust");
  });

  test("names a vault settings file that it could not use", async () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(oldSettingsPath(), "not json");
    const prepared = await start();
    expect(prepared.notes).toContainEqual({
      level: "warn",
      message: "The vault's settings were not used.",
      fields: { problem: `${vaultSettingsPath(vault)} is not valid JSON.` },
    });
  });
});
