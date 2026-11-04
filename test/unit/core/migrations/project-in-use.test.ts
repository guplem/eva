import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitProjectInUse } from "../../../../src/core/migrations/project-in-use.ts";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { parseFrontMatter } from "../../../../src/core/projects/project-catalog.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-project-in-use-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(vaultPath: string | null = vault): MigrationRun {
  return runMigrations({
    store: "vault",
    migrations: [splitProjectInUse],
    paths,
    vaultPath,
    version: "1.70.0",
    now: () => new Date("2026-11-04T08:00:00.000Z"),
  });
}

function project(name: string, text: string): string {
  const folder = join(vault, "Projects", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "AGENTS.md"), text);
  return join(folder, "AGENTS.md");
}

describe("splitProjectInUse (vault, #859)", () => {
  test("turns in-use into closed with the flag, and idea into paused, and changes nothing else", () => {
    const used = project(
      "2025-03-02-1015-recipes",
      "---\ncreated: 2025-03-02T10:15\nstatus: in-use # idea, active, in-use, paused or closed\ntags: [home]\n---\n# Recipes\n\nstatus: in-use\n",
    );
    const idea = project(
      "2025-03-03-1015-someday",
      "---\ncreated: 2025-03-03T10:15\nstatus: idea\ncustom: kept\n---\n# Someday\n",
    );
    expect(migrate()).toEqual({ kind: "done", applied: ["2026-11-04-project-in-use"], later: [] });
    expect(readFileSync(used, "utf-8")).toBe(
      "---\ncreated: 2025-03-02T10:15\nstatus: closed # active, paused or closed\nin-use: true\ntags: [home]\n---\n# Recipes\n\nstatus: in-use\n",
    );
    expect(readFileSync(idea, "utf-8")).toBe(
      "---\ncreated: 2025-03-03T10:15\nstatus: paused\ncustom: kept\n---\n# Someday\n",
    );
    expect(parseFrontMatter(readFileSync(used, "utf-8")).frontMatter).toMatchObject({ status: "closed", inUse: true });
  });

  test("updates Eva's old lists in the comment of any status, and keeps a comment of the person", () => {
    const lists = project("2025-03-02-1015-app", "---\nstatus: active # idea, active, paused or closed\n---\n# App\n");
    const own = project("2025-03-03-1015-own", "---\nstatus: in-use # my menus\n---\n# Own\n");
    migrate();
    expect(readFileSync(lists, "utf-8")).toBe("---\nstatus: active # active, paused or closed\n---\n# App\n");
    expect(readFileSync(own, "utf-8")).toBe("---\nstatus: closed # my menus\nin-use: true\n---\n# Own\n");
  });

  test("keeps Windows line endings, a byte order mark, quotes, and an in-use key that is already there", () => {
    const windows = project(
      "2025-03-02-1015-windows",
      '\uFEFF---\r\ncreated: 2025-03-02T10:15\r\nstatus: "in-use"\r\n---\r\n# Windows\r\n',
    );
    const flagged = project("2025-03-03-1015-flagged", "---\nin-use: true\nstatus: in-use\n---\n# Flagged\n");
    migrate();
    expect(readFileSync(windows, "utf-8")).toBe(
      '\uFEFF---\r\ncreated: 2025-03-02T10:15\r\nstatus: "closed"\r\nin-use: true\r\n---\r\n# Windows\r\n',
    );
    expect(readFileSync(flagged, "utf-8")).toBe("---\nin-use: true\nstatus: closed\n---\n# Flagged\n");
  });

  test("skips a project with a new status, a broken front matter, or no front matter", () => {
    const texts = [
      "---\nstatus: active\n---\n# Active\n",
      "---\nstatus: [in-use\n---\n",
      "No front matter.\nstatus: idea\n",
    ];
    const files = texts.map((text, index) => project(`2025-03-0${String(index + 1)}-1015-p${String(index)}`, text));
    migrate();
    expect(files.map((file) => readFileSync(file, "utf-8"))).toEqual(texts);
  });

  test("skips a folder of Projects/ whose name is no project id", () => {
    const text = "---\nstatus: in-use\n---\n";
    const files = ["Templates", "2025-03-02-1015-App", "notes"].map((name) => project(name, text));
    migrate();
    expect(files.map((file) => readFileSync(file, "utf-8"))).toEqual(files.map(() => text));
  });

  test("waits for a vault folder that is not there yet, and runs on a vault with no Projects folder", () => {
    expect(migrate(join(root, "missing"))).toEqual({ kind: "done", applied: [], later: ["2026-11-04-project-in-use"] });
    expect(migrate()).toEqual({ kind: "done", applied: ["2026-11-04-project-in-use"], later: [] });
  });
});
