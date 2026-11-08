import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCreatedOffsets } from "../../../../src/core/migrations/project-created-offset.ts";
import { runMigrations, type Migration, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import { discoverProjects } from "../../../../src/core/projects/project-catalog.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-created-offset-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva", "settings"), { recursive: true });
  record(["2026-11-03-format-settings"]);
  settings({ timeZone: "Europe/Madrid" });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function record(ids: readonly string[]): void {
  const applied = ids.map((id) => ({ id, at: "2026-11-03T08:00:00.000Z", version: "1.69.0" }));
  writeFileSync(join(vault, ".eva", "migrations.json"), JSON.stringify({ applied }));
}

function settings(value: unknown): void {
  writeFileSync(join(vault, ".eva", "settings", "settings.json"), JSON.stringify(value));
}

/** The record lists the format settings move, so this Eva must know it. Its own tests check what it does. */
function migrate(formatSettingsOutcome: "done" | "later" = "done"): MigrationRun {
  const formatSettings: Migration = {
    id: "2026-11-03-format-settings",
    store: "vault",
    run: () => formatSettingsOutcome,
  };
  return runMigrations({
    store: "vault",
    migrations: [formatSettings, addCreatedOffsets],
    paths,
    vaultPath: vault,
    version: "1.71.0",
    now: () => new Date("2026-11-06T08:00:00.000Z"),
  });
}

function project(name: string, text: string): string {
  const folder = join(vault, "Projects", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "AGENTS.md"), text);
  return join(folder, "AGENTS.md");
}

describe("addCreatedOffsets (vault)", () => {
  test("adds the offset of the time zone on that day, and changes nothing else", () => {
    const winter = project(
      "2026-01-31-0915-winter",
      "---\ncreated: 2026-01-31T09:15 # the creation time\nstatus: active\ncustom: kept\n---\n# Winter\n\ncreated: 2026-01-31T09:15\n",
    );
    const summer = project("2026-07-31-0915-summer", "---\r\ncreated: '2026-07-31T09:15'\r\nstatus: paused\r\n---\r\n");
    const day = project("2013-07-31-old-site", "---\ncreated: 2013-07-31\nstatus: closed\n---\n");
    const done = project("2026-02-01-0915-done", "---\ncreated: 2026-02-01T09:15-05:00\nstatus: active\n---\n");

    expect(migrate()).toEqual({ kind: "done", applied: ["2026-11-06-project-created-offset"], later: [] });
    expect(readFileSync(winter, "utf-8")).toBe(
      "---\ncreated: 2026-01-31T09:15+01:00 # the creation time\nstatus: active\ncustom: kept\n---\n# Winter\n\ncreated: 2026-01-31T09:15\n",
    );
    expect(readFileSync(summer, "utf-8")).toBe("---\r\ncreated: '2026-07-31T09:15+02:00'\r\nstatus: paused\r\n---\r\n");
    expect(readFileSync(day, "utf-8")).toBe("---\ncreated: 2013-07-31\nstatus: closed\n---\n");
    expect(readFileSync(done, "utf-8")).toBe("---\ncreated: 2026-02-01T09:15-05:00\nstatus: active\n---\n");
    // The new value still matches each folder name.
    expect(discoverProjects({ vaultPath: vault, extraRoots: [] }).flatMap((each) => each.warnings)).toEqual([]);
  });

  test("picks the offset on each side of a change to summer time", () => {
    const before = project("2026-03-29-0130-before", "---\ncreated: 2026-03-29T01:30\n---\n");
    const after = project("2026-03-29-0330-after", "---\ncreated: 2026-03-29T03:30\n---\n");
    migrate();
    expect(readFileSync(before, "utf-8")).toBe("---\ncreated: 2026-03-29T01:30+01:00\n---\n");
    expect(readFileSync(after, "utf-8")).toBe("---\ncreated: 2026-03-29T03:30+02:00\n---\n");
  });

  test("runs again safely: a second run changes nothing", () => {
    const file = project("2026-01-31-0915-winter", "---\ncreated: 2026-01-31T09:15\nstatus: active\n---\n");
    migrate();
    const first = readFileSync(file, "utf-8");
    rmSync(join(vault, ".eva", "migrations.json"));
    record(["2026-11-03-format-settings"]);
    migrate();
    expect(readFileSync(file, "utf-8")).toBe(first);
  });

  test("writes +00:00 in a zone at UTC", () => {
    settings({ timeZone: "UTC" });
    const file = project("2026-01-31-0915-utc", "---\ncreated: 2026-01-31T09:15\n---\n");
    migrate();
    expect(readFileSync(file, "utf-8")).toBe("---\ncreated: 2026-01-31T09:15+00:00\n---\n");
  });

  test("skips a broken front matter, a nested created key, a time that is not on the clock, and other folders", () => {
    const texts: Record<string, string> = {
      "2026-01-31-0915-broken": "---\ncreated: 2026-01-31T09:15\nstatus: [active\n---\n",
      "2026-01-31-0916-nested": "---\nhistory:\n  created: 2026-01-31T09:16\n---\n",
      "2026-01-31-2575-bad": "---\ncreated: 2026-01-31T25:75\n---\n",
    };
    const files = Object.entries(texts).map(([name, text]) => [project(name, text), text] as const);
    const other = join(vault, "Projects", "notes");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "AGENTS.md"), "---\ncreated: 2026-01-31T09:15\n---\n");
    expect(migrate()).toMatchObject({ kind: "done" });
    for (const [file, text] of files) expect(readFileSync(file, "utf-8")).toBe(text);
    expect(readFileSync(join(other, "AGENTS.md"), "utf-8")).toBe("---\ncreated: 2026-01-31T09:15\n---\n");
  });

  test("waits for the move of the time zone into the settings, and for a broken settings file", () => {
    const file = project("2026-01-31-0915-winter", "---\ncreated: 2026-01-31T09:15\n---\n");
    record([]);
    expect(migrate("later")).toEqual({
      kind: "done",
      applied: [],
      later: ["2026-11-03-format-settings", "2026-11-06-project-created-offset"],
    });
    record(["2026-11-03-format-settings"]);
    writeFileSync(join(vault, ".eva", "settings", "settings.json"), "{ broken");
    expect(migrate()).toEqual({ kind: "done", applied: [], later: ["2026-11-06-project-created-offset"] });
    expect(readFileSync(file, "utf-8")).toBe("---\ncreated: 2026-01-31T09:15\n---\n");
  });

  test("uses the zone of this computer when the settings name none", () => {
    settings({});
    const file = project("2026-01-31-0915-winter", "---\ncreated: 2026-01-31T09:15\n---\n");
    migrate();
    expect(readFileSync(file, "utf-8")).toMatch(/^---\ncreated: 2026-01-31T09:15[+-]\d{2}:\d{2}\n---\n$/);
  });
});
