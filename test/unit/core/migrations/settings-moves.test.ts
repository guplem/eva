import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { runMigrations, type Migration } from "../../../../src/core/migrations/migration-runner.ts";
import {
  copySecuritySettingsFromVault,
  dropSecuritySettingsFromVault,
  moveSharedSettingsToVault,
  startVaultSettings,
} from "../../../../src/core/migrations/settings-moves.ts";

let root: string;
let paths: HomePaths;
let vault: string;
let vaultSettings: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-settings-moves-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  vaultSettings = join(vault, ".eva", "settings.json");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Runs one migration alone, as the runner does, and gives its outcome. */
function migrate(migration: Migration, vaultPath: string | null = vault): "done" | "later" | "failed" {
  const result = runMigrations({
    store: migration.store,
    migrations: [migration],
    paths,
    vaultPath,
    version: "0.4.0",
    now: () => new Date("2026-10-20T08:00:00.000Z"),
  });
  if (result.kind === "failed") return "failed";
  if (result.kind === "ahead") throw new Error("unexpected");
  return result.later.length > 0 ? "later" : "done";
}

describe("moveSharedSettingsToVault (machine)", () => {
  test("is a machine migration", () => {
    expect(moveSharedSettingsToVault.store).toBe("machine");
  });

  test("drops the shared keys from config.json when the vault has a settings file: the vault wins", () => {
    writeJson(paths.config, { vaultPath: vault, port: 4000, timeZone: "UTC", updates: { frequency: "daily" } });
    writeJson(vaultSettings, { timeZone: "Asia/Tokyo" });
    expect(migrate(moveSharedSettingsToVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({ vaultPath: vault, port: 4000 });
    expect(readJson(vaultSettings)).toEqual({ timeZone: "Asia/Tokyo" });
  });

  test("keeps a machine key that shares a parent with a vault key", () => {
    writeJson(paths.config, {
      vaultPath: vault,
      engines: { default: "pi", claudeCode: { defaultModel: "opus", executable: "/opt/claude" } },
    });
    writeJson(vaultSettings, {});
    migrate(moveSharedSettingsToVault);
    expect(readJson(paths.config)).toEqual({
      vaultPath: vault,
      engines: { claudeCode: { executable: "/opt/claude" } },
    });
  });

  test("a machine that uses the default vault folder drops its shared keys too", () => {
    writeJson(paths.config, { port: 4000, timeZone: "UTC" });
    writeJson(vaultSettings, {});
    expect(migrate(moveSharedSettingsToVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({ port: 4000 });
  });

  test("waits while the vault has no settings file, and the values in config.json still work", () => {
    writeJson(paths.config, { vaultPath: vault, timeZone: "Europe/Madrid" });
    expect(migrate(moveSharedSettingsToVault)).toBe("later");
    expect(readJson(paths.config)).toEqual({ vaultPath: vault, timeZone: "Europe/Madrid" });
    expect(existsSync(vaultSettings)).toBe(false);
  });

  test("waits while the vault folder is missing", () => {
    writeJson(paths.config, { vaultPath: join(root, "not-cloned"), timeZone: "Europe/Madrid" });
    expect(migrate(moveSharedSettingsToVault, join(root, "not-cloned"))).toBe("later");
  });

  test("a fresh install, a config without a vault, or one without shared keys has nothing to move", () => {
    expect(migrate(moveSharedSettingsToVault)).toBe("done");
    rmSync(paths.migrationRecord);
    writeJson(paths.config, { timeZone: "Europe/Madrid" });
    expect(migrate(moveSharedSettingsToVault, null)).toBe("done");
    expect(readJson(paths.config)).toEqual({ timeZone: "Europe/Madrid" });
    rmSync(paths.migrationRecord);
    writeJson(paths.config, { vaultPath: vault, port: 4000 });
    expect(migrate(moveSharedSettingsToVault)).toBe("done");
  });

  test("waits on a broken config.json, so a later start tries again", () => {
    writeFileSync(paths.config, "{ broken");
    expect(migrate(moveSharedSettingsToVault)).toBe("later");
  });
});

describe("startVaultSettings (vault)", () => {
  test("is a vault migration", () => {
    expect(startVaultSettings.store).toBe("vault");
  });

  test("the hub's config.json starts the vault's settings file", () => {
    writeJson(paths.config, { vaultPath: vault, port: 4000, timeZone: "Europe/Madrid", google: { email: "a@b.c" } });
    expect(migrate(startVaultSettings)).toBe("done");
    expect(readJson(vaultSettings)).toEqual({ timeZone: "Europe/Madrid", google: { email: "a@b.c" } });
    expect(readJson(paths.config)).toMatchObject({ timeZone: "Europe/Madrid" });
  });

  test("an existing settings file wins", () => {
    writeJson(paths.config, { vaultPath: vault, timeZone: "UTC" });
    writeJson(vaultSettings, { timeZone: "Asia/Tokyo" });
    expect(migrate(startVaultSettings)).toBe("done");
    expect(readJson(vaultSettings)).toEqual({ timeZone: "Asia/Tokyo" });
  });

  test("without a shared key in config.json, no file starts", () => {
    writeJson(paths.config, { vaultPath: vault, port: 4000 });
    expect(migrate(startVaultSettings)).toBe("done");
    expect(existsSync(vaultSettings)).toBe(false);
  });

  test("then each machine drops its copy at its next start", () => {
    writeJson(paths.config, { vaultPath: vault, timeZone: "Europe/Madrid" });
    expect(migrate(moveSharedSettingsToVault)).toBe("later");
    migrate(startVaultSettings);
    expect(migrate(moveSharedSettingsToVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({ vaultPath: vault });
  });
});

describe("copySecuritySettingsFromVault (machine)", () => {
  const vaultSecurity = {
    remoteAccess: { allowedTailscaleIdentities: ["owner@example.com"] },
    trust: { trustedRepositoryOwners: ["example-owner"] },
    google: { email: "owner@example.com", readOnly: false, services: ["gmail"] },
  };

  test("is a machine migration", () => {
    expect(copySecuritySettingsFromVault.store).toBe("machine");
  });

  test("a key that config.json lacks takes the vault's value; the vault file stays as it is", () => {
    writeJson(paths.config, { vaultPath: vault });
    writeJson(vaultSettings, { ...vaultSecurity, timeZone: "Asia/Tokyo" });
    expect(migrate(copySecuritySettingsFromVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({
      vaultPath: vault,
      remoteAccess: { allowedTailscaleIdentities: ["owner@example.com"] },
      trust: { trustedRepositoryOwners: ["example-owner"] },
      google: { readOnly: false, services: ["gmail"] },
    });
    expect(readJson(vaultSettings)).toEqual({ ...vaultSecurity, timeZone: "Asia/Tokyo" });
  });

  test("a __proto__ key in config.json changes no prototype", () => {
    writeFileSync(paths.config, `{"vaultPath":${JSON.stringify(vault)},"__proto__":{"polluted":true}}`);
    writeJson(vaultSettings, { trust: { trustedRepositoryOwners: ["example-owner"] } });
    expect(migrate(copySecuritySettingsFromVault)).toBe("done");
    const written = readJson(paths.config);
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
    expect(written["polluted"]).toBeUndefined();
    expect(written).toMatchObject({ trust: { trustedRepositoryOwners: ["example-owner"] } });
  });

  test("a key that config.json has keeps its value", () => {
    writeJson(paths.config, { vaultPath: vault, trust: { trustedRepositoryOwners: ["machine-owner"] } });
    writeJson(vaultSettings, { trust: { trustedRepositoryOwners: ["other"] } });
    migrate(copySecuritySettingsFromVault);
    expect(readJson(paths.config)).toEqual({ vaultPath: vault, trust: { trustedRepositoryOwners: ["machine-owner"] } });
  });

  test("an invalid vault value is never copied, so Eva still starts", () => {
    writeJson(paths.config, { vaultPath: vault });
    writeJson(vaultSettings, { trust: { trustedRepositoryOwners: "not-a-list" } });
    expect(migrate(copySecuritySettingsFromVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({ vaultPath: vault });
  });

  test("waits while the machine has no vault: a later setup can join a vault that still holds the keys", () => {
    expect(migrate(copySecuritySettingsFromVault, null)).toBe("later");
    writeJson(paths.config, { port: 4000 });
    expect(migrate(copySecuritySettingsFromVault, null)).toBe("later");
  });

  test("nothing to copy without a vault file, or without a security key in it", () => {
    writeJson(paths.config, { vaultPath: vault });
    expect(migrate(copySecuritySettingsFromVault)).toBe("done");
    rmSync(paths.migrationRecord);
    writeJson(vaultSettings, { timeZone: "UTC" });
    expect(migrate(copySecuritySettingsFromVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({ vaultPath: vault });
  });

  test("waits while the vault folder is missing", () => {
    writeJson(paths.config, { vaultPath: join(root, "not-cloned") });
    expect(migrate(copySecuritySettingsFromVault, join(root, "not-cloned"))).toBe("later");
  });

  test("a machine that uses the default vault folder, with no vaultPath in config.json, copies too", () => {
    writeJson(paths.config, { port: 4000 });
    writeJson(vaultSettings, { trust: { trustedRepositoryOwners: ["example-owner"] } });
    expect(migrate(copySecuritySettingsFromVault)).toBe("done");
    expect(readJson(paths.config)).toEqual({ port: 4000, trust: { trustedRepositoryOwners: ["example-owner"] } });
  });
});

describe("dropSecuritySettingsFromVault (vault)", () => {
  test("is a vault migration", () => {
    expect(dropSecuritySettingsFromVault.store).toBe("vault");
  });

  test("drops every security key from the vault file and keeps the rest", () => {
    writeJson(vaultSettings, {
      remoteAccess: { allowedTailscaleIdentities: ["owner@example.com"] },
      trust: { trustedRepositoryOwners: ["example-owner"] },
      google: { email: "owner@example.com", readOnly: false, services: ["gmail"] },
      timeZone: "Asia/Tokyo",
    });
    expect(migrate(dropSecuritySettingsFromVault)).toBe("done");
    expect(readJson(vaultSettings)).toEqual({ google: { email: "owner@example.com" }, timeZone: "Asia/Tokyo" });
  });

  test("a missing file, or one without a security key, has nothing to drop", () => {
    expect(migrate(dropSecuritySettingsFromVault)).toBe("done");
    rmSync(join(vault, ".eva", "migrations.json"));
    writeJson(vaultSettings, { timeZone: "UTC" });
    expect(migrate(dropSecuritySettingsFromVault)).toBe("done");
    expect(readJson(vaultSettings)).toEqual({ timeZone: "UTC" });
  });

  test("waits on a broken vault file", () => {
    writeFileSync(vaultSettings, "{ broken");
    expect(migrate(dropSecuritySettingsFromVault)).toBe("later");
  });
});
