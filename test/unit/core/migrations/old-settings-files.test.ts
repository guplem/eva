import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import {
  migrationBackupPath,
  runMigrations,
  type Migration,
} from "../../../../src/core/migrations/migration-runner.ts";
import { migrations } from "../../../../src/core/migrations/migrations.ts";
import { modelTiersInConfig } from "../../../../src/core/migrations/model-tiers.ts";
import {
  deleteOldSettingsFiles,
  dropOldSharedKeysFromConfig,
} from "../../../../src/core/migrations/old-settings-files.ts";
import { moveSettingsToFolder } from "../../../../src/core/migrations/settings-folder.ts";
import { moveSharedSettingsToVault, startVaultSettings } from "../../../../src/core/migrations/settings-moves.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-old-settings-files-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(...list: Migration[]): { applied: string[]; later: string[] } {
  const result = runMigrations({
    store: list[0]?.store ?? "vault",
    migrations: list,
    paths,
    vaultPath: vault,
    version: "5.58.0",
    now: () => new Date("2026-11-22T08:00:00.000Z"),
  });
  if (result.kind !== "done") throw new Error(`unexpected ${result.kind}`);
  return { applied: result.applied, later: result.later };
}

function write(path: string, content: string): void {
  mkdirSync(join(vault, path, ".."), { recursive: true });
  writeFileSync(join(vault, path), content);
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

describe("deleteOldSettingsFiles (#685)", () => {
  test("is a dated vault migration in the list", () => {
    expect(deleteOldSettingsFiles.store).toBe("vault");
    expect(deleteOldSettingsFiles.id).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    expect(migrations).toContain(deleteOldSettingsFiles);
    expect(migrations).toContain(dropOldSharedKeysFromConfig);
  });

  test("after the move, it deletes the old files, keeps a copy, and the new files stay", () => {
    write(".eva/settings.json", '{ "timeZone": "Europe/Madrid" }\n');
    write(".eva/chat-names.md", "Lead with an emoji.\n");
    expect(migrate(startVaultSettings, moveSettingsToFolder, deleteOldSettingsFiles).applied).toEqual([
      startVaultSettings.id,
      moveSettingsToFolder.id,
      deleteOldSettingsFiles.id,
    ]);
    expect(existsSync(join(vault, ".eva", "settings.json"))).toBe(false);
    expect(existsSync(join(vault, ".eva", "chat-names.md"))).toBe(false);
    expect(read(".eva/settings/settings.json")).toBe('{ "timeZone": "Europe/Madrid" }\n');
    expect(read(".eva/settings/chat-names.md")).toBe("Lead with an emoji.\n");
    const backup = migrationBackupPath(paths, deleteOldSettingsFiles, join(".eva", "chat-names.md"));
    expect(readFileSync(backup, "utf-8")).toBe("Lead with an emoji.\n");
    const settingsBackup = migrationBackupPath(paths, deleteOldSettingsFiles, join(".eva", "settings.json"));
    expect(readFileSync(settingsBackup, "utf-8")).toBe('{ "timeZone": "Europe/Madrid" }\n');
  });

  test("waits while the move has not run, because the old files hold the only copy", () => {
    write(".eva/settings.json", "{ not json");
    expect(migrate(startVaultSettings, moveSettingsToFolder, deleteOldSettingsFiles)).toEqual({
      applied: [startVaultSettings.id],
      later: [moveSettingsToFolder.id, deleteOldSettingsFiles.id],
    });
    expect(read(".eva/settings.json")).toBe("{ not json");
  });

  test("waits for the start of the vault settings, which still writes the old place", () => {
    write(".eva/settings/settings.json", "{}\n");
    write(".eva/migrations.json", JSON.stringify({ applied: [{ id: moveSettingsToFolder.id, at: "", version: "" }] }));
    expect(migrate(moveSettingsToFolder, deleteOldSettingsFiles).later).toEqual([deleteOldSettingsFiles.id]);
  });

  test("a vault without the old files has nothing to delete", () => {
    expect(migrate(startVaultSettings, moveSettingsToFolder, deleteOldSettingsFiles).applied).toHaveLength(3);
    expect(existsSync(join(vault, ".eva", "settings"))).toBe(false);
  });

  test("an instance without a vault has nothing to delete", () => {
    const context = { paths, vaultPath: null, write: () => expect.unreachable() };
    expect(deleteOldSettingsFiles.run(context)).toBe("done");
  });
});

describe("dropOldSharedKeysFromConfig (#685)", () => {
  const readConfig = (): unknown => JSON.parse(readFileSync(paths.config, "utf-8"));
  const machineMigrations = [moveSharedSettingsToVault, modelTiersInConfig, dropOldSharedKeysFromConfig];
  const oldConfig = {
    port: 4000,
    timeZone: "Europe/Madrid",
    engines: { claudeCode: { executable: "/opt/claude", defaultModel: "default" } },
  };

  test("is a dated machine migration", () => {
    expect(dropOldSharedKeysFromConfig.store).toBe("machine");
    expect(dropOldSharedKeysFromConfig.id).toMatch(/^\d{4}-\d{2}-\d{2}-/);
  });

  test("with only the new vault file, it drops the old keys, and the old migrations finish at the next start", () => {
    writeFileSync(paths.config, JSON.stringify(oldConfig));
    write(".eva/settings/settings.json", "{}\n");
    // Both old migrations wait for .eva/settings.json, which the vault no longer has.
    expect(migrate(...machineMigrations)).toEqual({
      applied: [dropOldSharedKeysFromConfig.id],
      later: [moveSharedSettingsToVault.id, modelTiersInConfig.id],
    });
    expect(readConfig()).toEqual({ port: 4000, engines: { claudeCode: { executable: "/opt/claude" } } });
    expect(migrate(...machineMigrations)).toEqual({
      applied: [moveSharedSettingsToVault.id, modelTiersInConfig.id],
      later: [],
    });
  });

  test("waits while the vault has no settings file in either place, as the old migrations do", () => {
    writeFileSync(paths.config, JSON.stringify(oldConfig));
    expect(migrate(dropOldSharedKeysFromConfig).later).toEqual([dropOldSharedKeysFromConfig.id]);
    expect(readConfig()).toEqual(oldConfig);
    write(".eva/settings.json", "{}\n");
    expect(migrate(dropOldSharedKeysFromConfig).applied).toEqual([dropOldSharedKeysFromConfig.id]);
  });

  test("a config.json without old keys, or no config.json, stays as it is", () => {
    expect(migrate(dropOldSharedKeysFromConfig).applied).toHaveLength(1);
    expect(existsSync(paths.config)).toBe(false);
    rmSync(paths.migrationRecord, { force: true });
    writeFileSync(paths.config, JSON.stringify({ port: 4000 }));
    expect(migrate(dropOldSharedKeysFromConfig).applied).toHaveLength(1);
    expect(readConfig()).toEqual({ port: 4000 });
  });
});
