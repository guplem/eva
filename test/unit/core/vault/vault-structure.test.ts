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

  test("v5 adds the folder rule for Principles/ and Methods/, with no migration of its own (#851)", () => {
    const v5 = structureChanges.find((change) => change.version === 5);
    expect(v5?.summary).toStartWith("Eva reads your principles and your methods before she acts");
    expect(v5?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(5);
  });

  test("v9 merges Life/Objects/ and Life/Finances/ into Life/Inventory/, links included (#940)", () => {
    const v9 = structureChanges.find((change) => change.version === 9);
    expect(v9?.summary).toStartWith("Everything you have or use");
    expect(v9?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(9);
  });

  test("v10 offers the rules for file groups, small files, spreadsheets and job records (#949)", () => {
    const v10 = structureChanges.find((change) => change.version === 10);
    expect(v10?.summary).toStartWith("Clearer rules for the files you keep");
    expect(v10?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(10);
  });

  test("v11 gives habits of any kind their own folder, Life/Habits/, and moves nothing (#1001)", () => {
    const v11 = structureChanges.find((change) => change.version === 11);
    expect(v11?.summary).toStartWith("Your habits get a folder of their own");
    expect(v11?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(11);
  });

  test("v12 withdraws v11: a new vault gets no Life/Habits/, and a habit file never moves (#1028)", () => {
    const v12 = structureChanges.find((change) => change.version === 12);
    expect(v12?.summary).toStartWith("Life/Habits leaves the vault map");
    expect(v12?.migrations).toEqual([]);
    // The v11 entry stays: some vaults applied it, and v12 tells them how to go back.
    expect(structureChanges.some((change) => change.version === 11)).toBe(true);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(12);
    // The upgrade deletes Life/Habits/AGENTS.md only when it matches this text byte for byte.
    const changelog = readFileSync(
      join(import.meta.dir, "../../../../templates/eva-core/skills/vault-upgrade/CHANGELOG.md"),
      "utf-8",
    );
    expect(changelog).toContain(
      "**Not here:**\n- The steps of a routine or a training plan → `Methods/`. A habit file can name the method in its `note`.\n",
    );
  });

  test("v13 offers the rule that judges the rigor of a source, and moves nothing (#1031)", () => {
    const v13 = structureChanges.find((change) => change.version === 13);
    expect(v13?.summary).toStartWith("Eva checks how serious a source is");
    expect(v13?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(13);
    const changelog = readFileSync(
      join(import.meta.dir, "../../../../templates/eva-core/skills/vault-upgrade/CHANGELOG.md"),
      "utf-8",
    );
    // The upgrade never judges an old Health note, so it moves none.
    expect(changelog).toContain("A note that is already in `Life/Health/` stays where it is.");
  });

  test("v14 offers the cloud drive rules for files needed away from Eva or shared, and moves nothing alone (#1065)", () => {
    const v14 = structureChanges.find((change) => change.version === 14);
    expect(v14?.summary).toStartWith("Files you need in a hurry");
    expect(v14?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(14);
  });

  test("v15 offers the task app link of a project and the rule for what to do now, and moves nothing (#1093)", () => {
    const v15 = structureChanges.find((change) => change.version === 15);
    expect(v15?.summary).toStartWith("A project can link its own list in your task app");
    expect(v15?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(15);
  });

  test("v16 offers the rule for where each secret goes, and moves a secret only with a yes (#1095)", () => {
    const v16 = structureChanges.find((change) => change.version === 16);
    expect(v16?.summary).toStartWith("Eva knows where each kind of secret goes");
    expect(v16?.migrations).toEqual([]);
    expect(newestStructureVersion).toBeGreaterThanOrEqual(16);
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
