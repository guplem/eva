import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeProjectTypes } from "../../../../src/core/migrations/project-types.ts";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;
let map: string;

/** The _Projects_ section of the vault map before 2026-10-30. */
const oldSection = [
  "## Projects",
  "",
  "Each project is a folder `Projects/YYYY-MM-DD-HHmm-name/`. Its `AGENTS.md` starts with YAML front matter:",
  "",
  "```yaml",
  "---",
  "created: 2026-01-31T09:15",
  "status: active # idea, active, paused or closed",
  "repos:",
  "  - https://github.com/example/example-app",
  "---",
  "```",
  "",
  "The text under the front matter says what an agent must know about the project. The project's notes sit beside it.",
  "",
  "`Projects/<id>/repos/clone-<n>/` holds a clone of the project.",
  "",
].join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-project-types-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  map = join(vault, "AGENTS.md");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(vaultPath: string | null = vault): MigrationRun {
  return runMigrations({
    store: "vault",
    migrations: [describeProjectTypes],
    paths,
    vaultPath,
    version: "1.50.0",
    now: () => new Date("2026-10-30T08:00:00.000Z"),
  });
}

describe("describeProjectTypes (vault, #703)", () => {
  test("adds the type to the example, and says what the text means for each type", () => {
    writeFileSync(map, `# Map\n\n${oldSection}`);
    expect(migrate().kind).toBe("done");
    const text = readFileSync(map, "utf-8");
    expect(text).toContain(
      "status: active # idea, active, paused or closed\ntype: software # software or specialist. No type means software\nrepos:",
    );
    expect(text).toContain("- **Specialist:** a chat with its own rules and memory");
    expect(text).not.toContain("says what an agent must know");
    // The rest of the map stays as it was.
    expect(text).toStartWith("# Map\n\n## Projects\n");
    expect(text).toEndWith("`Projects/<id>/repos/clone-<n>/` holds a clone of the project.\n");
  });

  test("a map made after the in-use status (#690) gets the type too", () => {
    const withInUse = oldSection.replace(
      "status: active # idea, active, paused or closed",
      "status: active # idea, active, in-use, paused or closed",
    );
    writeFileSync(map, withInUse);
    migrate();
    const text = readFileSync(map, "utf-8");
    expect(text).toContain(
      "status: active # idea, active, in-use, paused or closed\ntype: software # software or specialist. No type means software\nrepos:",
    );
    expect(text).toContain("A project is one of two types:");
  });

  test("keeps Windows line ends", () => {
    writeFileSync(map, oldSection.replaceAll("\n", "\r\n"));
    migrate();
    const text = readFileSync(map, "utf-8");
    expect(text).toContain("type: software # software or specialist. No type means software\r\nrepos:");
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("a text that the person changed stays as it is, in the example or in the paragraph", () => {
    for (const edited of [
      oldSection.replace("says what an agent must know", "holds what I want"),
      oldSection.replace("status: active # idea, active, paused or closed", "status: active"),
    ]) {
      writeFileSync(map, edited);
      rmSync(join(vault, ".eva"), { recursive: true, force: true });
      expect(migrate()).toMatchObject({ kind: "done", applied: [describeProjectTypes.id] });
      expect(readFileSync(map, "utf-8")).toBe(edited);
    }
  });

  test("the new text is the template's text, so a new vault and a migrated vault read the same", () => {
    writeFileSync(map, oldSection);
    migrate();
    const migrated = readFileSync(map, "utf-8");
    const template = readFileSync(join(import.meta.dir, "../../../../templates/vault/AGENTS.md"), "utf-8");
    const typesOf = (text: string): string => text.slice(text.indexOf("A project is one of two types:"));
    expect(typesOf(template).startsWith(typesOf(migrated).split("\n\n`Projects/")[0] ?? "")).toBe(true);
  });

  test("a vault with no map has nothing to change", () => {
    expect(migrate()).toMatchObject({ kind: "done", applied: [describeProjectTypes.id] });
  });
});
