import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultConfig,
  homePaths,
  loadConfig,
  saveConfig,
  type HomePaths,
} from "../../../../src/core/settings/home.ts";
import {
  changeSettings,
  describeSettings,
  isSettingKey,
  isSharedSettingKey,
  loadSettings,
  moveSecuritySettingsFromVault,
  moveSettingsToVault,
  saveSettings,
  settingChange,
  vaultSettingsPath,
  withVaultSettings,
} from "../../../../src/core/settings/settings.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-settings-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(vault);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

describe("where each setting lives", () => {
  test("without a vault, every setting stays in config.json", () => {
    saveSettings(paths, { ...defaultConfig, timeZone: "Europe/Madrid" });
    expect(loadConfig(paths).timeZone).toBe("Europe/Madrid");
    expect(loadSettings(paths)).toEqual({ config: { ...defaultConfig, timeZone: "Europe/Madrid" }, problem: null });
  });

  test("with a vault, the person's settings go to the vault and the machine's stay home", () => {
    const config = {
      ...defaultConfig,
      vaultPath: vault,
      port: 7421,
      timeZone: "Europe/Madrid",
      updates: { frequency: "weekly" as const },
    };
    saveSettings(paths, config);
    const machine = readJson(paths.config);
    const shared = readJson(vaultSettingsPath(vault));
    expect(machine).toMatchObject({ vaultPath: vault, port: 7421 });
    expect(machine).not.toHaveProperty("timeZone");
    expect(machine).not.toHaveProperty("updates");
    expect(shared).toMatchObject({ timeZone: "Europe/Madrid", updates: { frequency: "weekly" } });
    expect(shared).not.toHaveProperty("port");
    expect(shared).not.toHaveProperty("vaultPath");
    expect(loadSettings(paths).config).toEqual(config);
  });

  test("the vault wins over config.json, and a machine key in the vault file is ignored", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault, timeZone: "UTC", port: 7421 });
    mkdirSync(join(vault, ".eva"));
    writeFileSync(vaultSettingsPath(vault), JSON.stringify({ timeZone: "Asia/Tokyo", port: 9999 }));
    expect(loadSettings(paths)).toMatchObject({ config: { timeZone: "Asia/Tokyo", port: 7421 }, problem: null });
  });

  test("a broken vault file never stops Eva: the config stays, and the problem is named (lesson 54)", () => {
    const config = { ...defaultConfig, vaultPath: vault, timeZone: "UTC" };
    mkdirSync(join(vault, ".eva"));
    writeFileSync(vaultSettingsPath(vault), "{ not json");
    expect(withVaultSettings(config).config).toEqual(config);
    expect(withVaultSettings(config).problem).toContain("not valid JSON");
    writeFileSync(vaultSettingsPath(vault), "[1]");
    expect(withVaultSettings(config).problem).toContain("JSON object");
    writeFileSync(vaultSettingsPath(vault), JSON.stringify({ updates: { frequency: "sometimes" } }));
    expect(withVaultSettings(config).config).toEqual(config);
    expect(withVaultSettings(config).problem).toContain("updates.frequency");
  });

  test("a broken config.json is an error, as before", () => {
    mkdirSync(paths.root);
    writeFileSync(paths.config, "{ not json");
    let caught: unknown = null;
    try {
      loadSettings(paths);
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "config_invalid")).toBe(true);
  });
});

describe("changeSettings", () => {
  test("a change merges key by key and saves to the right file", () => {
    saveSettings(paths, { ...defaultConfig, vaultPath: vault });
    const changed = changeSettings(paths, { sync: { pullIntervalMinutes: null } });
    expect(changed.sync).toEqual({ enabled: true, sweepSeconds: 60, pullIntervalMinutes: null });
    expect(readJson(vaultSettingsPath(vault))).toMatchObject({ sync: { pullIntervalMinutes: null } });
    expect(loadSettings(paths).config.sync.pullIntervalMinutes).toBeNull();
  });

  test("a bad value is refused and nothing is saved", () => {
    expect(() => changeSettings(paths, { updates: { frequency: "sometimes" } })).toThrow("updates.frequency");
    expect(existsSync(paths.config)).toBe(false);
  });
});

describe("moveSettingsToVault", () => {
  test("an older config.json starts the vault's settings file", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid" });
    expect(moveSettingsToVault(paths)).toBe(true);
    expect(readJson(vaultSettingsPath(vault))).toMatchObject({ timeZone: "Europe/Madrid" });
    expect(readJson(paths.config)).not.toHaveProperty("timeZone");
    expect(loadSettings(paths).config.timeZone).toBe("Europe/Madrid");
    expect(moveSettingsToVault(paths)).toBe(false);
  });

  test("when the vault already has settings from another machine, the vault wins", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault, timeZone: "UTC" });
    mkdirSync(join(vault, ".eva"));
    writeFileSync(vaultSettingsPath(vault), JSON.stringify({ timeZone: "Asia/Tokyo" }));
    expect(moveSettingsToVault(paths)).toBe(true);
    expect(readJson(vaultSettingsPath(vault))).toEqual({ timeZone: "Asia/Tokyo" });
    expect(loadSettings(paths).config.timeZone).toBe("Asia/Tokyo");
  });

  test("nothing moves without a config file, a vault, or a vault folder", () => {
    expect(moveSettingsToVault(paths)).toBe(false);
    saveConfig(paths, defaultConfig);
    expect(moveSettingsToVault(paths)).toBe(false);
    saveConfig(paths, { ...defaultConfig, vaultPath: join(root, "missing") });
    expect(moveSettingsToVault(paths)).toBe(false);
  });
});

describe("security settings stay on the machine", () => {
  const vaultSecurity = {
    remoteAccess: { allowedTailscaleIdentities: ["intruder@example.com"] },
    trust: { trustedRepositoryOwners: ["intruder"] },
    google: { email: "owner@example.com", readOnly: false, services: ["gmail"] },
  };

  function writeVaultSettings(value: unknown): void {
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(vaultSettingsPath(vault), JSON.stringify(value));
  }

  test("the vault's values for the security keys are ignored; the Google account still comes from the vault", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    writeVaultSettings(vaultSecurity);
    const config = loadSettings(paths).config;
    expect(config.remoteAccess.allowedTailscaleIdentities).toEqual([]);
    expect(config.trust.trustedRepositoryOwners).toEqual([]);
    expect(config.google).toEqual({ ...defaultConfig.google, email: "owner@example.com" });
  });

  test("a save keeps the security keys in config.json and out of the vault", () => {
    saveSettings(paths, {
      ...defaultConfig,
      vaultPath: vault,
      trust: { trustedRepositoryOwners: ["example-owner"] },
      google: { email: "owner@example.com", readOnly: false, services: ["calendar"] },
    });
    expect(readJson(paths.config)).toMatchObject({
      trust: { trustedRepositoryOwners: ["example-owner"] },
      google: { readOnly: false, services: ["calendar"] },
      remoteAccess: { allowedTailscaleIdentities: [] },
    });
    const shared = readJson(vaultSettingsPath(vault));
    expect(shared).not.toHaveProperty("trust");
    expect(shared).not.toHaveProperty("remoteAccess");
    expect(shared).toMatchObject({ google: { email: "owner@example.com" } });
    expect(shared["google"]).toEqual({ email: "owner@example.com" });
    expect(isSharedSettingKey("trust.trustedRepositoryOwners")).toBe(false);
    expect(isSharedSettingKey("google.readOnly")).toBe(false);
    expect(isSharedSettingKey("google.email")).toBe(true);
  });

  test("migration: a key that config.json lacks moves once from the vault to config.json", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    const machine = readJson(paths.config);
    Reflect.deleteProperty(machine, "trust");
    Reflect.deleteProperty(machine, "google");
    Reflect.deleteProperty(machine, "remoteAccess");
    writeFileSync(paths.config, JSON.stringify(machine));
    writeVaultSettings({ ...vaultSecurity, timeZone: "Asia/Tokyo" });
    expect(moveSecuritySettingsFromVault(paths)).toBe(true);
    expect(readJson(paths.config)).toMatchObject({
      remoteAccess: { allowedTailscaleIdentities: ["intruder@example.com"] },
      trust: { trustedRepositoryOwners: ["intruder"] },
      google: { readOnly: false, services: ["gmail"] },
    });
    expect(readJson(paths.config)).not.toHaveProperty("google.email");
    expect(readJson(vaultSettingsPath(vault))).toEqual({
      google: { email: "owner@example.com" },
      timeZone: "Asia/Tokyo",
    });
    expect(loadSettings(paths).config.trust.trustedRepositoryOwners).toEqual(["intruder"]);
    expect(moveSecuritySettingsFromVault(paths)).toBe(false);
  });

  test("migration: a key that config.json has keeps its value, and the vault's copy goes", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault, trust: { trustedRepositoryOwners: ["example-owner"] } });
    writeVaultSettings({ trust: { trustedRepositoryOwners: ["intruder"] } });
    expect(moveSecuritySettingsFromVault(paths)).toBe(true);
    expect(readJson(paths.config)).toMatchObject({ trust: { trustedRepositoryOwners: ["example-owner"] } });
    expect(readJson(vaultSettingsPath(vault))).toEqual({});
  });

  test("migration: an invalid vault value is dropped, never copied, so Eva still starts", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    const machine = readJson(paths.config);
    Reflect.deleteProperty(machine, "trust");
    writeFileSync(paths.config, JSON.stringify(machine));
    writeVaultSettings({ trust: { trustedRepositoryOwners: "not-a-list" } });
    expect(moveSecuritySettingsFromVault(paths)).toBe(true);
    expect(readJson(paths.config)).not.toHaveProperty("trust");
    expect(readJson(vaultSettingsPath(vault))).toEqual({});
    expect(loadSettings(paths).config.trust).toEqual(defaultConfig.trust);
  });

  test("migration: nothing moves without a config file, a vault file, or a security key in it", () => {
    expect(moveSecuritySettingsFromVault(paths)).toBe(false);
    saveConfig(paths, defaultConfig);
    expect(moveSecuritySettingsFromVault(paths)).toBe(false);
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    expect(moveSecuritySettingsFromVault(paths)).toBe(false);
    writeVaultSettings("[1]");
    expect(moveSecuritySettingsFromVault(paths)).toBe(false);
    writeVaultSettings({ timeZone: "UTC" });
    expect(moveSecuritySettingsFromVault(paths)).toBe(false);
  });
});

describe("settings by command", () => {
  test("a dotted key names a setting, and the vault's keys are known", () => {
    expect(isSettingKey("updates.frequency")).toBe(true);
    expect(isSettingKey("engines.pi.models.opus")).toBe(true);
    expect(isSettingKey("updates.never")).toBe(false);
    expect(isSettingKey("port.number")).toBe(false);
    expect(isSharedSettingKey("updates.frequency")).toBe(true);
    expect(isSharedSettingKey("engines.claudeCode.executable")).toBe(false);
  });

  test("a value is JSON when it parses, and text otherwise", () => {
    expect(settingChange("updates.frequency", "weekly")).toEqual({ updates: { frequency: "weekly" } });
    expect(settingChange("port", "7500")).toEqual({ port: 7500 });
    expect(settingChange("sync.pullIntervalMinutes", "null")).toEqual({ sync: { pullIntervalMinutes: null } });
    expect(settingChange("projectRoots", '["/a"]')).toEqual({ projectRoots: ["/a"] });
    expect(() => settingChange("nope", "1")).toThrow("nope is not a setting");
  });

  test("the list marks the settings that the vault holds", () => {
    const lines = describeSettings(defaultConfig);
    expect(lines).toContain('updates.frequency = "daily"  (vault)');
    expect(lines).toContain("port = 7420");
    expect(lines).toContain("projectRoots = []");
  });
});
