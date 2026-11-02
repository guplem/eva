import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { pinFiles } from "../../../../src/core/migrations/pinned-files.ts";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-pinned-migration-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

function migrate(vaultPath: string | null = vault): MigrationRun {
  return runMigrations({
    store: "vault",
    migrations: [pinFiles],
    paths,
    vaultPath,
    version: "1.60.0",
    now: () => new Date("2026-11-02T08:00:00.000Z"),
  });
}

const projectFile = "Projects/2025-01-01-0900-app/AGENTS.md";

describe("pinFiles (vault, #769)", () => {
  test("gives each project the summary that the old block showed, quoted, and keeps the body", () => {
    write(
      projectFile,
      '---\ncreated: 2025-01-01T09:00\nstatus: active # a comment\n---\n# App\n\nPlan: phase 1, the "best" #one.\n',
    );
    expect(migrate()).toEqual({ kind: "done", applied: ["2026-11-02-pinned-files"], later: [] });
    expect(read(projectFile)).toBe(
      '---\ncreated: 2025-01-01T09:00\nstatus: active # a comment\nsummary: "Plan: phase 1, the \\"best\\" #one."\n---\n# App\n\nPlan: phase 1, the "best" #one.\n',
    );
    const header = parseYaml(/^---\n([\s\S]*?)\n---/.exec(read(projectFile))?.[1] ?? "") as Record<string, string>;
    expect(header["summary"]).toBe('Plan: phase 1, the "best" #one.');
  });

  test("leaves a project with a summary, with no description, or with a broken front matter as it is", () => {
    const files = {
      [projectFile]: "---\nstatus: active\nsummary: Own.\n---\n# App\n\nText.\n",
      "Projects/2025-01-02-0900-empty/AGENTS.md": "---\nstatus: active\n---\n# Empty\n\n- a list\n",
      "Projects/2025-01-03-0900-broken/AGENTS.md": "---\nstatus: [\n---\n# Broken\n\nText.\n",
    };
    for (const [path, text] of Object.entries(files)) write(path, text);
    migrate();
    for (const [path, text] of Object.entries(files)) expect(read(path)).toBe(text);
  });

  test("turns a `> Important:` line under the title into `pinned: summary`, with its reason as the summary", () => {
    write("Notes/Keys.md", "# Keys\n\n> Important: where the spare key is\n\nUnder the mat.\n");
    write("Notes/Owned.md", "---\ntags: [home]\n---\n# Owned\n> Important: a reason\nText.\n");
    write("Notes/Both.md", "---\nsummary: Own words.\n---\n# Both\n\n> Important: kept reason\n");
    migrate();
    expect(read("Notes/Keys.md")).toBe(
      '---\nsummary: "where the spare key is"\npinned: summary\n---\n# Keys\n\nUnder the mat.\n',
    );
    expect(read("Notes/Owned.md")).toBe(
      '---\ntags: [home]\nsummary: "a reason"\npinned: summary\n---\n# Owned\nText.\n',
    );
    // A note with its own summary keeps the line, so no text is lost.
    expect(read("Notes/Both.md")).toBe(
      "---\nsummary: Own words.\npinned: summary\n---\n# Both\n\n> Important: kept reason\n",
    );
  });

  test("touches no other note, and never a hidden folder, the old Scratch/ or a clone", () => {
    const files = {
      "Notes/Later.md": "# Later\n\nText.\n\n> Important: not first\n",
      "Notes/Pinned.md": "---\npinned: false\n---\n# Pinned\n\n> Important: the person chose\n",
      ".eva/scratch/a.md": "# A\n\n> Important: x\n",
      "Scratch/a.md": "# A\n\n> Important: x\n",
      "Projects/2025-01-01-0900-app/repos/clone-0/app/README.md": "# A\n\n> Important: x\n",
    };
    for (const [path, text] of Object.entries(files)) write(path, text);
    migrate();
    for (const [path, text] of Object.entries(files)) expect(read(path)).toBe(text);
  });

  test("waits for a vault", () => {
    expect(migrate(null)).toEqual({ kind: "done", applied: [], later: [] });
    expect(migrate(join(root, "missing"))).toEqual({ kind: "done", applied: [], later: ["2026-11-02-pinned-files"] });
  });
});
