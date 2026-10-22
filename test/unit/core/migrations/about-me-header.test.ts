import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAboutMeHeader } from "../../../../src/core/migrations/about-me-header.ts";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { readAboutMe } from "../../../../src/core/vault/about-me.ts";

let root: string;
let paths: HomePaths;
let vault: string;
let note: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-about-me-header-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  note = join(vault, "Life", "About me.md");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, "Life"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(vaultPath: string | null = vault): MigrationRun {
  return runMigrations({
    store: "vault",
    migrations: [addAboutMeHeader],
    paths,
    vaultPath,
    version: "1.40.0",
    now: () => new Date("2026-10-22T08:00:00.000Z"),
  });
}

describe("addAboutMeHeader (vault)", () => {
  test("adds the header with the name from the note, and keeps the note below it", () => {
    writeFileSync(note, "# About Alex\n\n- **Name:** Alex\n");
    expect(migrate().kind).toBe("done");
    const text = readFileSync(note, "utf-8");
    expect(text).toStartWith("---\n# The basic facts");
    expect(text).toEndWith("---\n\n# About Alex\n\n- **Name:** Alex\n");
    expect(readAboutMe(vault)).toMatchObject({ name: "Alex", birthDate: null, problems: [] });
  });

  test("keeps Windows line ends", () => {
    writeFileSync(note, "# About Alex\r\n");
    migrate();
    expect(readFileSync(note, "utf-8")).toStartWith("---\r\n# The basic facts");
    expect(readAboutMe(vault).problems).toEqual([]);
  });

  test("leaves a note that already has a header, and a vault with no note", () => {
    writeFileSync(note, "---\nname: Alex\n---\n\n# About Alex\n");
    migrate();
    expect(readFileSync(note, "utf-8")).toBe("---\nname: Alex\n---\n\n# About Alex\n");
    rmSync(note);
    expect(migrate(join(root, "other")).kind).toBe("done");
  });

  test("leaves the name empty when the note does not give it", () => {
    writeFileSync(note, "# About me\n");
    migrate();
    expect(readAboutMe(vault).name).toBeNull();
  });
});
