import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertVaultWritable, migrations, vaultAhead } from "../../../../src/core/migrations/migrations.ts";
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
