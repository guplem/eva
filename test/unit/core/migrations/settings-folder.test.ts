import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationBackupPath, runMigrations } from "../../../../src/core/migrations/migration-runner.ts";
import { moveSettingsToFolder } from "../../../../src/core/migrations/settings-folder.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-settings-folder-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(): void {
  const result = runMigrations({
    store: "vault",
    migrations: [moveSettingsToFolder],
    paths,
    vaultPath: vault,
    version: "1.40.0",
    now: () => new Date("2026-10-30T08:00:00.000Z"),
  });
  expect(result).toEqual({ kind: "done", applied: [moveSettingsToFolder.id], later: [] });
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

describe("moveSettingsToFolder (vault)", () => {
  test("copies the settings and the chat name rules into .eva/settings/, and keeps the old files", () => {
    writeFileSync(join(vault, ".eva", "settings.json"), '{ "timeZone": "Europe/Madrid" }\n');
    writeFileSync(join(vault, ".eva", "chat-names.md"), "Lead with an emoji.\n");
    migrate();
    expect(read(".eva/settings/settings.json")).toBe('{ "timeZone": "Europe/Madrid" }\n');
    expect(read(".eva/settings/chat-names.md")).toBe("Lead with an emoji.\n");
    // An older satellite reads only the old place, until it updates.
    expect(read(".eva/settings.json")).toBe('{ "timeZone": "Europe/Madrid" }\n');
    expect(read(".eva/chat-names.md")).toBe("Lead with an emoji.\n");
  });

  test("the old file wins over a new one, because it holds the newest value before the move", () => {
    writeFileSync(join(vault, ".eva", "chat-names.md"), "Lead with an emoji.\n");
    mkdirSync(join(vault, ".eva", "settings"));
    writeFileSync(join(vault, ".eva", "settings", "chat-names.md"), "Older rules.\n");
    migrate();
    expect(read(".eva/settings/chat-names.md")).toBe("Lead with an emoji.\n");
    const backup = migrationBackupPath(paths, moveSettingsToFolder, join(".eva", "settings", "chat-names.md"));
    expect(readFileSync(backup, "utf-8")).toBe("Older rules.\n");
  });

  test("a vault without the old files gets no new files", () => {
    migrate();
    expect(existsSync(join(vault, ".eva", "settings"))).toBe(false);
  });

  test("an instance without a vault has nothing to move", () => {
    const context = { paths, vaultPath: null, write: () => expect.unreachable() };
    expect(moveSettingsToFolder.run(context)).toBe("done");
  });
});

describe("moveSettingsToFolder with a broken settings file", () => {
  test("waits until the old file is valid, so the older migrations can still clean it first", () => {
    writeFileSync(join(vault, ".eva", "settings.json"), "{ not json");
    writeFileSync(join(vault, ".eva", "chat-names.md"), "Lead with an emoji.\n");
    const result = runMigrations({
      store: "vault",
      migrations: [moveSettingsToFolder],
      paths,
      vaultPath: vault,
      version: "1.40.0",
      now: () => new Date("2026-10-30T08:00:00.000Z"),
    });
    expect(result).toEqual({ kind: "done", applied: [], later: [moveSettingsToFolder.id] });
    expect(existsSync(join(vault, ".eva", "settings"))).toBe(false);
    writeFileSync(join(vault, ".eva", "settings.json"), "{}\n");
    migrate();
    expect(read(".eva/settings/chat-names.md")).toBe("Lead with an emoji.\n");
  });

  test("runs again safely after a stop halfway", () => {
    writeFileSync(join(vault, ".eva", "settings.json"), "{}\n");
    writeFileSync(join(vault, ".eva", "chat-names.md"), "Lead with an emoji.\n");
    mkdirSync(join(vault, ".eva", "settings"));
    writeFileSync(join(vault, ".eva", "settings", "settings.json"), "{}\n");
    migrate();
    expect(read(".eva/settings/settings.json")).toBe("{}\n");
    expect(read(".eva/settings/chat-names.md")).toBe("Lead with an emoji.\n");
  });
});

describe("moveSettingsToFolder with settings that Eva cannot read", () => {
  test.each([["[1]"], ['{ "updates": { "frequency": "sometimes" } }']])("waits for %s", (text) => {
    writeFileSync(join(vault, ".eva", "settings.json"), text);
    const result = runMigrations({
      store: "vault",
      migrations: [moveSettingsToFolder],
      paths,
      vaultPath: vault,
      version: "1.40.0",
      now: () => new Date("2026-10-30T08:00:00.000Z"),
    });
    expect(result).toEqual({ kind: "done", applied: [], later: [moveSettingsToFolder.id] });
  });
});
