import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newestStructureVersion,
  parseChangelog,
  readStructureNotices,
  readVaultStructure,
  structureChanges,
  structureWarning,
  structurePromptLine,
  upgradeBranchVersion,
  vaultStructurePath,
  writeStructureNotices,
  writeVaultStructure,
} from "../../../../src/core/vault/vault-structure.ts";
import { vaultTemplateFiles } from "../../../../src/core/vault/vault-template.ts";
import { migrations } from "../../../../src/core/migrations/migrations.ts";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-structure-"));
  mkdirSync(join(vault, ".eva"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("the CHANGELOG", () => {
  test("its first entry is v3, with a short summary and the migrations that run first", () => {
    const v3 = structureChanges.find((change) => change.version === 3);
    expect(v3?.summary).toStartWith("Your notes in Life/ get one folder for each thing");
    expect(v3?.migrations).toEqual([
      "2026-11-02-eva-scratch",
      "2026-11-02-general-project-type",
      "2026-11-02-pinned-files",
      "2026-11-03-format-settings",
    ]);
    expect(newestStructureVersion).toBe(structureChanges.at(-1)?.version ?? 0);
  });

  test("names only migrations that this Eva knows", () => {
    const known = new Set(
      migrations.filter((migration) => migration.store === "vault").map((migration) => migration.id),
    );
    for (const change of structureChanges) for (const id of change.migrations) expect(known.has(id)).toBe(true);
  });

  test("a parse keeps the entries in version order and leaves out one with no whole version", () => {
    const text = [
      "# Changes",
      "## v5",
      "- **Version:** 5",
      "- **Summary:** Five.",
      "## draft",
      "- **Version:** soon",
      "## v4",
      "- **Version:** 4",
      "- **Summary:** Four.",
      "- **Migrations first:** a, b",
    ].join("\n");
    expect(parseChangelog(text)).toEqual([
      { version: 4, summary: "Four.", migrations: ["a", "b"] },
      { version: 5, summary: "Five.", migrations: [] },
    ]);
  });

  test("a new vault records the newest version, so it shows no upgrade", () => {
    const files = vaultTemplateFiles({ name: "Sam", notesLanguage: "English", topics: [] });
    expect(JSON.parse(files[".eva/vault-structure.json"] ?? "")).toEqual({ version: newestStructureVersion });
  });
});

describe("the record", () => {
  test("a missing, damaged or odd record reads as version 2", () => {
    expect(readVaultStructure(vault)).toBe(2);
    for (const text of ["{", "[]", '{"version":"3"}', '{"version":2.5}', '{"version":-1}']) {
      writeFileSync(vaultStructurePath(vault), text);
      expect(readVaultStructure(vault)).toBe(2);
    }
    writeFileSync(vaultStructurePath(vault), '{"version":3}');
    expect(readVaultStructure(vault)).toBe(3);
  });

  test("a write keeps the fields of a newer Eva", () => {
    writeFileSync(vaultStructurePath(vault), '{"version":2,"newer":true}');
    writeVaultStructure(vault, 3);
    expect(JSON.parse(readFileSync(vaultStructurePath(vault), "utf-8"))).toEqual({ version: 3, newer: true });
  });

  test("the hub's notices read tolerantly", () => {
    const path = join(vault, "notices.json");
    expect(readStructureNotices(path)).toEqual({ announced: 0, prompted: 0, read: 0 });
    writeFileSync(path, "{");
    expect(readStructureNotices(path)).toEqual({ announced: 0, prompted: 0, read: 0 });
    // The file of #773 has no read version.
    writeFileSync(path, JSON.stringify({ announced: 3, prompted: 3 }));
    expect(readStructureNotices(path)).toEqual({ announced: 3, prompted: 3, read: 0 });
    writeStructureNotices(path, { announced: 3, prompted: 0, read: 3 });
    expect(readStructureNotices(path)).toEqual({ announced: 3, prompted: 0, read: 3 });
  });
});

describe("the words", () => {
  test("the prompt line is exact", () => {
    expect(structurePromptLine(3, 2)).toBe(
      "[Vault structure: version 3 is available. This vault is at version 2. Run the vault-upgrade skill when the person agrees.]",
    );
  });

  test("the warning gives the versions and the Settings card, and names no slash command", () => {
    expect(structureWarning(3, 2)).toBe(
      "A new vault structure (version 3) is ready. Your vault is at version 2. To update it, open Settings, Vault and sync, Vault structure, or ask the Assistant.",
    );
  });

  test("only an upgrade branch has a version", () => {
    expect(upgradeBranchVersion("upgrade-v3")).toBe(3);
    expect(upgradeBranchVersion("main")).toBeNull();
    expect(upgradeBranchVersion("upgrade-v3-old")).toBeNull();
  });
});
