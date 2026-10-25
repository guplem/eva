import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homePaths, parseConfig, type HomePaths } from "../../../../src/core/settings/home.ts";
import { runMigrations, type Migration } from "../../../../src/core/migrations/migration-runner.ts";
import { modelTiersInConfig, modelTiersInVault } from "../../../../src/core/migrations/model-tiers.ts";

let root: string;
let paths: HomePaths;
let vault: string;
let vaultFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-model-tiers-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  vaultFile = join(vault, ".eva", "settings.json");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(migration: Migration): "done" | "later" | "failed" {
  const result = runMigrations({
    store: migration.store,
    migrations: [migration],
    paths,
    vaultPath: vault,
    version: "0.9.0",
    now: () => new Date("2026-10-24T08:00:00.000Z"),
  });
  if (result.kind === "failed") return "failed";
  if (result.kind === "ahead") throw new Error("unexpected");
  return result.later.length > 0 ? "later" : "done";
}

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const oldEngines = {
  default: "pi",
  claudeCode: { executable: "/opt/claude", defaultModel: "default", permissionMode: "auto" },
  pi: { models: { default: "openai/gpt-5-mini", opus: "openai/gpt-5", sonnet: null, haiku: null } },
};

const newEngines = {
  default: "pi",
  defaultModel: "opus",
  claudeCode: { executable: "/opt/claude", permissionMode: "auto" },
  pi: { models: { opus: "openai/gpt-5", sonnet: "openai/gpt-5-mini", haiku: "openai/gpt-5-mini" } },
};

describe("model tiers (#550)", () => {
  test("are dated migrations, one for each store", () => {
    expect(modelTiersInVault.store).toBe("vault");
    expect(modelTiersInConfig.store).toBe("machine");
    for (const migration of [modelTiersInVault, modelTiersInConfig])
      expect(migration.id).toMatch(/^\d{4}-\d{2}-\d{2}-/);
  });

  test("the vault's Default model becomes Smart, and its one pi model fills each empty tier", () => {
    writeFileSync(vaultFile, JSON.stringify({ timeZone: "UTC", engines: oldEngines }));
    expect(migrate(modelTiersInVault)).toBe("done");
    expect(read(vaultFile)).toEqual({ timeZone: "UTC", engines: newEngines });
  });

  test("a chosen model stays, and config.json changes the same way", () => {
    const engines = { ...oldEngines, claudeCode: { ...oldEngines.claudeCode, defaultModel: "haiku" } };
    writeFileSync(paths.config, JSON.stringify({ port: 4000, engines }));
    // Until the hub starts the vault's file, the old key must stay for its frozen copy.
    expect(migrate(modelTiersInConfig)).toBe("later");
    expect(read(paths.config)).toEqual({ port: 4000, engines });
    writeFileSync(vaultFile, "{}");
    expect(migrate(modelTiersInConfig)).toBe("done");
    expect(read(paths.config)).toEqual({ port: 4000, engines: { ...newEngines, defaultModel: "haiku" } });
    expect(parseConfig(read(paths.config), "config.json").engines.defaultModel).toBe("haiku");
  });

  test("a file in the new form, or with no file, stays as it is", () => {
    expect(migrate(modelTiersInVault)).toBe("done");
    expect(migrate(modelTiersInConfig)).toBe("done");
    writeFileSync(vaultFile, JSON.stringify({ engines: newEngines }));
    expect(migrate(modelTiersInVault)).toBe("done");
    expect(read(vaultFile)).toEqual({ engines: newEngines });
  });

  test("a broken file waits for a fix", () => {
    writeFileSync(vaultFile, "{ not json");
    expect(migrate(modelTiersInVault)).toBe("later");
  });
});
