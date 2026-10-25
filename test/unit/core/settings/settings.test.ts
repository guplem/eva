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
      updates: { frequency: "weekly" as const, install: "minor" as const },
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

  test("the update policy lives in the vault, and an older vault file without it gets minor", () => {
    expect(defaultConfig.updates.install).toBe("minor");
    saveSettings(paths, { ...defaultConfig, vaultPath: vault, updates: { frequency: "daily", install: "patch" } });
    expect(readJson(vaultSettingsPath(vault))).toMatchObject({ updates: { install: "patch" } });
    writeFileSync(vaultSettingsPath(vault), JSON.stringify({ updates: { frequency: "weekly" } }));
    expect(loadSettings(paths).config.updates).toEqual({ frequency: "weekly", install: "minor" });
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

describe("security settings stay on the machine", () => {
  const vaultSecurity = {
    remoteAccess: { allowedTailscaleIdentities: ["intruder@example.com"] },
    trust: { trustedRepositoryOwners: ["intruder"] },
    google: { email: "owner@example.com", access: { calendar: "full" }, services: ["gmail"] },
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
      google: {
        email: "owner@example.com",
        access: { ...defaultConfig.google.access, calendar: "full" },
        services: ["calendar"],
      },
    });
    expect(readJson(paths.config)).toMatchObject({
      trust: { trustedRepositoryOwners: ["example-owner"] },
      google: { access: { calendar: "full" }, services: ["calendar"] },
      remoteAccess: { allowedTailscaleIdentities: [] },
    });
    const shared = readJson(vaultSettingsPath(vault));
    expect(shared).not.toHaveProperty("trust");
    expect(shared).not.toHaveProperty("remoteAccess");
    expect(shared).toMatchObject({ google: { email: "owner@example.com" } });
    expect(shared["google"]).toEqual({ email: "owner@example.com" });
    expect(isSharedSettingKey("trust.trustedRepositoryOwners")).toBe(false);
    expect(isSharedSettingKey("google.access.calendar")).toBe(false);
    expect(isSharedSettingKey("google.email")).toBe(true);
  });
});

describe("the model and the effort of new chats (#550)", () => {
  test("a new instance gives new chats Smart and Medium, and the vault holds both", () => {
    expect(defaultConfig.engines).toMatchObject({ defaultModel: "opus", defaultEffort: "medium" });
    expect(isSharedSettingKey("engines.defaultModel")).toBe(true);
    expect(isSharedSettingKey("engines.defaultEffort")).toBe(true);
  });

  test("an old vault's Claude Code model applies to new chats, and its Default reads as Smart", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    mkdirSync(join(vault, ".eva"));
    const old = (model: string): string => JSON.stringify({ engines: { claudeCode: { defaultModel: model } } });
    writeFileSync(vaultSettingsPath(vault), old("sonnet"));
    expect(loadSettings(paths).config.engines.defaultModel).toBe("sonnet");
    writeFileSync(vaultSettingsPath(vault), old("default"));
    expect(loadSettings(paths).config.engines.defaultModel).toBe("opus");
  });

  test("the old single pi model fills each tier that names no model, and a save writes the new form", () => {
    saveConfig(paths, { ...defaultConfig, vaultPath: vault });
    mkdirSync(join(vault, ".eva"));
    const models = { default: "openai/gpt-5-mini", opus: "openai/gpt-5", sonnet: null };
    writeFileSync(vaultSettingsPath(vault), JSON.stringify({ engines: { pi: { models } } }));
    const config = loadSettings(paths).config;
    expect(config.engines.pi.models).toEqual({
      opus: "openai/gpt-5",
      sonnet: "openai/gpt-5-mini",
      haiku: "openai/gpt-5-mini",
    });
    saveSettings(paths, config);
    expect(readJson(vaultSettingsPath(vault))).toMatchObject({
      engines: { defaultModel: "opus", defaultEffort: "medium", pi: { models: { haiku: "openai/gpt-5-mini" } } },
    });
    expect(JSON.stringify(readJson(vaultSettingsPath(vault)))).not.toContain('"default":"openai');
  });

  test("a save also writes the old Claude Code key, so an older hub keeps the person's model", () => {
    saveSettings(paths, {
      ...defaultConfig,
      vaultPath: vault,
      engines: { ...defaultConfig.engines, defaultModel: "sonnet" },
    });
    expect(readJson(vaultSettingsPath(vault))).toMatchObject({
      engines: { defaultModel: "sonnet", claudeCode: { defaultModel: "sonnet" } },
    });
    expect(loadSettings(paths).config.engines.defaultModel).toBe("sonnet");
  });

  test("eva settings set still takes the old Claude Code key, and its Default means Smart", () => {
    expect(isSharedSettingKey("engines.claudeCode.defaultModel")).toBe(true);
    expect(settingChange("engines.claudeCode.defaultModel", "haiku")).toEqual({
      engines: { claudeCode: { defaultModel: "haiku" } },
    });
    changeSettings(paths, settingChange("engines.claudeCode.defaultModel", "haiku"));
    expect(loadSettings(paths).config.engines.defaultModel).toBe("haiku");
    changeSettings(paths, settingChange("engines.claudeCode.defaultModel", "default"));
    expect(loadSettings(paths).config.engines.defaultModel).toBe("opus");
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
    // A security setting: an agent edits the vault.
    expect(isSharedSettingKey("engines.claudeCode.permissionMode")).toBe(false);
  });

  test("a value is JSON when it parses, and text otherwise", () => {
    expect(settingChange("updates.frequency", "weekly")).toEqual({ updates: { frequency: "weekly" } });
    expect(settingChange("port", "7500")).toEqual({ port: 7500 });
    expect(settingChange("sync.pullIntervalMinutes", "null")).toEqual({ sync: { pullIntervalMinutes: null } });
    expect(settingChange("projectRoots", '["/a"]')).toEqual({ projectRoots: ["/a"] });
    expect(() => settingChange("nope", "1")).toThrow("nope is not a setting");
  });

  test("a save keeps google.readOnly until its migration runs, so the old access is not lost", () => {
    // `eva setup` after an update saves settings before the next start runs the migrations.
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.config, JSON.stringify({ google: { readOnly: false } }));
    changeSettings(paths, { port: 7500 });
    expect(readJson(paths.config)).toMatchObject({ port: 7500, google: { readOnly: false } });
    expect(isSettingKey("google.readOnly")).toBe(false);
  });

  test("the list marks the settings that the vault holds", () => {
    const lines = describeSettings(defaultConfig);
    expect(lines).toContain('updates.frequency = "daily"  (vault)');
    expect(lines).toContain("port = 7420");
    expect(lines).toContain("projectRoots = []");
  });
});

describe("a vault that a newer Eva migrated (#119)", () => {
  function writeNewerRecord(): void {
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(
      join(vault, ".eva", "migrations.json"),
      JSON.stringify({ applied: [{ id: "2099-01-01-from-the-future", at: "", version: "9.0.0" }] }),
    );
  }

  test("a change to a machine setting still saves, and the vault file stays as it is", () => {
    saveSettings(paths, { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid" });
    writeNewerRecord();
    const vaultBefore = readFileSync(vaultSettingsPath(vault), "utf-8");
    changeSettings(paths, { port: 7421 });
    expect(readJson(paths.config)).toMatchObject({ port: 7421 });
    expect(readFileSync(vaultSettingsPath(vault), "utf-8")).toBe(vaultBefore);
  });

  test("eva setup can still join the vault: it saves the vault's own values, so the vault needs no change", () => {
    writeNewerRecord();
    writeFileSync(vaultSettingsPath(vault), JSON.stringify({ timeZone: "Asia/Tokyo" }));
    saveConfig(paths, defaultConfig);
    const joined = withVaultSettings({ ...defaultConfig, vaultPath: vault }).config;
    saveSettings(paths, joined);
    expect(loadSettings(paths).config).toMatchObject({ vaultPath: vault, timeZone: "Asia/Tokyo" });
    expect(readJson(vaultSettingsPath(vault))).toEqual({ timeZone: "Asia/Tokyo" });
  });

  test("a change to a vault setting is refused with vault_ahead, and nothing is saved", () => {
    saveSettings(paths, { ...defaultConfig, vaultPath: vault, timeZone: "Europe/Madrid" });
    writeNewerRecord();
    const machineBefore = readFileSync(paths.config, "utf-8");
    const vaultBefore = readFileSync(vaultSettingsPath(vault), "utf-8");
    let caught: unknown = null;
    try {
      changeSettings(paths, { timeZone: "Asia/Tokyo", port: 7421 });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "vault_ahead")).toBe(true);
    expect(readFileSync(paths.config, "utf-8")).toBe(machineBefore);
    expect(readFileSync(vaultSettingsPath(vault), "utf-8")).toBe(vaultBefore);
  });
});
