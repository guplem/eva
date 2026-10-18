import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertVaultWritable,
  migrations,
  runStartMigrations,
  vaultAhead,
  type StartMigrationsOptions,
} from "../../../../src/core/migrations/migrations.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let vault: string;
const record = (): string => join(vault, ".eva", "migrations.json");

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-vault-gate-"));
  mkdirSync(join(vault, ".eva"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function writeRecord(ids: readonly string[], version = "0.9.0"): void {
  writeFileSync(record(), JSON.stringify({ applied: ids.map((id) => ({ id, at: "", version })) }));
}

describe("the migration list", () => {
  test("ids are unique and dated", () => {
    const ids = migrations.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  });
});

describe("the vault gate", () => {
  test("a vault without a record, or with only known ids, is writable", () => {
    expect(vaultAhead(vault)).toBeNull();
    writeRecord(migrations.filter((migration) => migration.store === "vault").map((migration) => migration.id));
    expect(vaultAhead(vault)).toBeNull();
    expect(() => {
      assertVaultWritable(vault);
    }).not.toThrow();
  });

  test("a machine migration id in the vault's record does not count as known", () => {
    writeRecord(migrations.filter((migration) => migration.store === "machine").map((migration) => migration.id));
    expect(vaultAhead(vault)?.unknown.length).toBeGreaterThan(0);
  });

  test("an unknown id stops every vault write with vault_ahead and names the version", () => {
    writeRecord(["2099-01-01-from-the-future"], "9.1.0");
    expect(vaultAhead(vault)).toEqual({ unknown: ["2099-01-01-from-the-future"], version: "9.1.0" });
    let caught: unknown;
    try {
      assertVaultWritable(vault);
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "vault_ahead")).toBe(true);
    expect((caught as Error).message).toContain("9.1.0");
  });
});

describe("runStartMigrations", () => {
  let paths: HomePaths;
  const ids = (store: "machine" | "vault"): string[] =>
    migrations
      .filter((migration) => migration.store === store)
      .map((migration) => migration.id)
      .sort();
  const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf-8"));
  const start = (overrides: Partial<StartMigrationsOptions> = {}): ReturnType<typeof runStartMigrations> =>
    runStartMigrations({
      paths,
      vaultPath: vault,
      isHub: () => true,
      version: "0.4.0",
      now: () => new Date("2026-10-20T08:00:00.000Z"),
      ...overrides,
    });

  beforeEach(() => {
    paths = homePaths(mkdtempSync(join(tmpdir(), "eva-start-home-")));
    mkdirSync(paths.root, { recursive: true });
  });
  afterEach(() => {
    rmSync(paths.root, { recursive: true, force: true });
  });

  test("a fresh install records every migration, and changes nothing", () => {
    expect(start()).toEqual({
      machine: { kind: "done", applied: ids("machine"), later: [] },
      vault: { kind: "done", applied: ids("vault"), later: [] },
    });
    expect(existsSync(join(vault, ".eva", "settings.json"))).toBe(false);
    expect(existsSync(paths.config)).toBe(false);
  });

  test("an install from before the migrations gets the new layout on the hub", () => {
    writeFileSync(paths.config, JSON.stringify({ vaultPath: vault, port: 4000, timeZone: "Europe/Madrid" }));
    writeFileSync(
      join(vault, ".eva", "settings.json"),
      JSON.stringify({ trust: { trustedRepositoryOwners: ["example-owner"] }, voice: { language: "es" } }),
    );
    const result = start();
    expect(result.machine.kind).toBe("done");
    expect(result.vault).toEqual({ kind: "done", applied: ids("vault"), later: [] });
    expect(readJson(paths.config)).toEqual({
      vaultPath: vault,
      port: 4000,
      trust: { trustedRepositoryOwners: ["example-owner"] },
    });
    expect(readJson(join(vault, ".eva", "settings.json"))).toEqual({ voice: { language: "es" } });
  });

  test("on a hub without a vault settings file, the shared keys move at the next start", () => {
    writeFileSync(paths.config, JSON.stringify({ vaultPath: vault, timeZone: "Europe/Madrid" }));
    const first = start();
    expect(first.machine).toMatchObject({ kind: "done", later: ["2026-10-18-move-shared-settings-to-vault"] });
    expect(readJson(join(vault, ".eva", "settings.json"))).toEqual({ timeZone: "Europe/Madrid" });
    expect(start().machine).toEqual({
      kind: "done",
      applied: ["2026-10-18-move-shared-settings-to-vault"],
      later: [],
    });
    expect(readJson(paths.config)).toEqual({ vaultPath: vault });
  });

  test("a satellite runs only the machine migrations", () => {
    writeFileSync(
      join(vault, ".eva", "settings.json"),
      JSON.stringify({ trust: { trustedRepositoryOwners: ["example-owner"] } }),
    );
    writeFileSync(paths.config, JSON.stringify({ vaultPath: vault }));
    const result = start({ isHub: () => false });
    expect(result.vault).toBeNull();
    expect(result.machine).toEqual({ kind: "done", applied: ids("machine"), later: [] });
    expect(readJson(join(vault, ".eva", "settings.json"))).toEqual({
      trust: { trustedRepositoryOwners: ["example-owner"] },
    });
    expect(existsSync(join(vault, ".eva", "migrations.json"))).toBe(false);
  });

  test("an older Eva that sees a newer vault still runs the machine migrations, and leaves the vault", () => {
    writeRecord(["2099-01-01-from-the-future"], "9.0.0");
    const result = start();
    expect(result.vault).toEqual({ kind: "ahead", unknown: ["2099-01-01-from-the-future"] });
    expect(result.machine.kind).toBe("done");
  });

  test("a failed migration of one store leaves the other store running", () => {
    const failing = {
      id: "2026-10-19-fails",
      store: "machine" as const,
      run: (): never => {
        throw new Error("broken");
      },
    };
    const result = start({ list: [...migrations, failing] });
    expect(result.machine).toMatchObject({ kind: "failed", id: "2026-10-19-fails", reason: "broken" });
    expect(result.vault).toEqual({ kind: "done", applied: ids("vault"), later: [] });
  });
});
