import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typeSoftwareProjects } from "../../../../src/core/migrations/general-project-type.ts";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { vaultTemplateFiles } from "../../../../src/core/vault/vault-template.ts";

let root: string;
let paths: HomePaths;
let vault: string;

/** The _Projects_ lines of the vault map from 2026-10-30 to this migration. */
const oldMap = [
  "## Projects",
  "",
  "```yaml",
  "---",
  "created: 2026-01-31T09:15",
  "status: active # idea, active, in-use, paused or closed",
  "type: software # software or specialist. No type means software",
  "repos:",
  "  - https://github.com/example/example-app",
  "---",
  "```",
  "",
  "A project is one of two types:",
  "",
  "- **Software:** work in repositories, such as an app, a website or a widget. The text under the front matter describes the project for the person and for you. It names the repository to read first. The rules for the code live in each repository's own `AGENTS.md`. The project's notes sit beside the file.",
  "- **Specialist:** a chat with its own rules and memory, such as a gym coach. The text under the front matter holds the rules of the specialist. Its memory and its other files sit beside the file. A specialist has no repository and no clone.",
  "",
].join("\n");

const generalBullet =
  "- **General:** a folder of notes and files, such as plans, reference photos or drafts: building a house, a scale model, a book. The text under the front matter describes the project.";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-general-type-"));
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
    migrations: [typeSoftwareProjects],
    paths,
    vaultPath,
    version: "1.60.0",
    now: () => new Date("2026-11-02T08:00:00.000Z"),
  });
}

function project(name: string, text: string): string {
  const folder = join(vault, "Projects", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "AGENTS.md"), text);
  return join(folder, "AGENTS.md");
}

describe("typeSoftwareProjects (vault, #768)", () => {
  test("writes `type: software` into each project with repos and no type, and changes nothing else", () => {
    const app = project(
      "2025-03-02-1015-app",
      "---\ncreated: 2025-03-02T10:15\nstatus: active # idea, active, in-use, paused or closed\nrepos:\n  - https://github.com/example/example-app\ncustom: kept\n---\n# App\n\nNotes.\n",
    );
    const windows = project(
      "2025-03-03-1015-api",
      "﻿---\r\ncreated: 2025-03-03T10:15\r\nrepos: [https://github.com/example/example-api]\r\n---\r\n# API\r\n",
    );
    expect(migrate()).toEqual({ kind: "done", applied: ["2026-11-02-general-project-type"], later: [] });
    expect(readFileSync(app, "utf-8")).toBe(
      "---\ncreated: 2025-03-02T10:15\nstatus: active # idea, active, in-use, paused or closed\ntype: software\nrepos:\n  - https://github.com/example/example-app\ncustom: kept\n---\n# App\n\nNotes.\n",
    );
    expect(readFileSync(windows, "utf-8")).toBe(
      "﻿---\r\ncreated: 2025-03-03T10:15\r\ntype: software\r\nrepos: [https://github.com/example/example-api]\r\n---\r\n# API\r\n",
    );
  });

  test("skips a project with any type, with no repos, or with a broken front matter", () => {
    const texts = [
      "---\nstatus: active\ntype: specialist\nrepos:\n  - https://github.com/example/example-app\n---\n",
      "---\nstatus: active\ntype: robot\nrepos:\n  - https://github.com/example/example-app\n---\n",
      "---\nstatus: active\n---\n# House\n",
      "---\nstatus: active\nrepos: []\n---\n",
      "---\nstatus: [active\nrepos:\n  - https://github.com/example/example-app\n---\n",
      "No front matter.\n",
    ];
    const files = texts.map((text, index) => project(`2025-03-0${String(index + 1)}-1015-p${String(index)}`, text));
    migrate();
    expect(files.map((file) => readFileSync(file, "utf-8"))).toEqual(texts);
  });

  test("waits for a vault folder that is not there yet", () => {
    expect(migrate(join(root, "missing"))).toEqual({
      kind: "done",
      applied: [],
      later: ["2026-11-02-general-project-type"],
    });
  });

  test("fixes each of Eva's exact lines of the vault map, and adds the General bullet above Software", () => {
    writeFileSync(join(vault, "AGENTS.md"), `# Map\n\n${oldMap}`);
    migrate();
    const text = readFileSync(join(vault, "AGENTS.md"), "utf-8");
    expect(text).toContain("type: software # general, software or specialist. No type means general\n");
    expect(text).toContain("A project is one of three types:\n");
    expect(text).toContain(`\n${generalBullet}\n- **Software:**`);
  });

  test("leaves each line that the person changed, and adds no bullet above a changed Software line", () => {
    const changed = oldMap
      .replace("A project is one of two types:", "My projects come in two types:")
      .replace("- **Software:** work in repositories", "- **Software:** code in repositories");
    writeFileSync(join(vault, "AGENTS.md"), changed);
    migrate();
    const text = readFileSync(join(vault, "AGENTS.md"), "utf-8");
    expect(text).toBe(
      changed.replace(
        "type: software # software or specialist. No type means software",
        "type: software # general, software or specialist. No type means general",
      ),
    );
  });

  test("a new vault's map already has the new text, so the migration changes nothing in it", () => {
    const map = vaultTemplateFiles({
      name: "Alex",
      language: "English",
      notesLanguage: "English",
      timeZone: "UTC",
      topics: [],
    })["AGENTS.md"];
    writeFileSync(join(vault, "AGENTS.md"), map ?? "");
    migrate();
    expect(readFileSync(join(vault, "AGENTS.md"), "utf-8")).toBe(map ?? "");
    expect(map).toContain(generalBullet);
    expect(map).toContain("A project is one of three types:");
    expect(map).toContain("type: software # general, software or specialist. No type means general");
  });
});
