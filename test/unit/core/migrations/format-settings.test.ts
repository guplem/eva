import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { moveFormatSettings } from "../../../../src/core/migrations/format-settings.ts";
import { moveSettingsToFolder } from "../../../../src/core/migrations/settings-folder.ts";
import { runMigrations, type MigrationRun } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-format-migration-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(vault, { recursive: true });
  recordSettingsFolder();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const aboutMe = "Life/About me.md";
const settingsFile = ".eva/settings/settings.json";

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

/** The vault's record after the settings folder migration of 2026-10-30, as a vault has it today. */
function recordSettingsFolder(): void {
  write(
    ".eva/migrations.json",
    JSON.stringify({
      applied: [{ id: "2026-10-30-settings-folder", at: "2026-10-30T08:00:00.000Z", version: "1.50.0" }],
    }),
  );
}

function read(path: string): string {
  return readFileSync(join(vault, path), "utf-8");
}

function settings(): Record<string, unknown> {
  return JSON.parse(read(settingsFile)) as Record<string, unknown>;
}

function migrate(migrations = [moveSettingsToFolder, moveFormatSettings]): MigrationRun {
  return runMigrations({
    store: "vault",
    // The settings folder migration runs first when the record lacks it, as on a real vault.
    migrations,
    paths,
    vaultPath: vault,
    version: "1.60.0",
    now: () => new Date("2026-11-03T08:00:00.000Z"),
  });
}

/** The note as the 2026-10-22 template wrote it, with values the person filled. */
const oldNote = [
  "---",
  "# The basic facts about the person, for Eva and her scripts. The about-me skill says how to fill each field.",
  'name: "Alex"',
  "birthDate: 1990-05-14 # YYYY-MM-DD",
  "units: imperial # metric or imperial",
  "clock: 12h # 24h or 12h",
  "weekStart: sunday # monday to sunday",
  "sleep: # from and to, as HH:mm",
  '  from: "23:30"',
  '  to: "07:30"',
  "places: # home, work and other places, each with a city",
  "  home: { city: San Francisco }",
  "  gym: { name: Example Gym, city: San Francisco }",
  "people: # each with a name, a relation and a birthDate",
  "  - { name: Sam, relation: partner, birthDate: 1991-02-03 }",
  "dates: # each with a name and a date",
  "  - { name: Wedding anniversary, date: 2018-09-15 }",
  "diet: [vegetarian]",
  "allergies: [peanuts]",
  "# Eva's code fills lastLocation from your phone. Keep it as it is.",
  "lastLocation:",
  "---",
  "",
  "# About Alex",
  "",
  "- **Name:** Alex",
  "- **Language for answers:** Spanish",
  "- **Time zone:** Europe/Madrid",
  "",
  "## Main topics",
  "",
  "- music",
  "",
].join("\n");

describe("moveFormatSettings (vault, #770)", () => {
  test("moves the format fields and both lines into empty settings, pins the note, and keeps the rest", () => {
    write(aboutMe, oldNote);
    write(settingsFile, JSON.stringify({ timeZone: null, updates: { frequency: "daily", install: "minor" } }));
    expect(migrate().kind).toBe("done");
    expect(settings()).toEqual({
      timeZone: "Europe/Madrid",
      updates: { frequency: "daily", install: "minor" },
      units: "imperial",
      clock: "12h",
      weekStart: "sunday",
      language: "Spanish",
    });
    const expected = oldNote
      .replace("units: imperial # metric or imperial\n", "")
      .replace("clock: 12h # 24h or 12h\n", "")
      .replace("weekStart: sunday # monday to sunday\n", "")
      .replace(
        "lastLocation:\n---",
        "lastLocation:\npinned: full # full, summary or false. full: Eva reads this whole note in every chat\n---",
      )
      .replace("- **Language for answers:** Spanish\n", "")
      .replace("- **Time zone:** Europe/Madrid\n", "");
    expect(read(aboutMe)).toBe(expected);
  });

  test("a setting that holds a value wins, and the field still leaves the note", () => {
    write(aboutMe, oldNote);
    write(settingsFile, JSON.stringify({ timeZone: "Asia/Tokyo", language: "English", clock: "24h" }));
    migrate();
    expect(settings()).toEqual({
      timeZone: "Asia/Tokyo",
      language: "English",
      clock: "24h",
      units: "imperial",
      weekStart: "sunday",
    });
    expect(read(aboutMe)).not.toContain("clock:");
    expect(read(aboutMe)).not.toContain("Language for answers");
  });

  test("a null setting from a newer satellite counts as empty", () => {
    write(aboutMe, oldNote);
    write(settingsFile, JSON.stringify({ units: null, clock: null }));
    migrate();
    expect(settings()).toMatchObject({ units: "imperial", clock: "12h" });
  });

  test("a bad value stays in the note, and an empty field or line leaves", () => {
    write(
      aboutMe,
      "---\nname: Alex\nunits: cubits\nclock:\nweekStart: # monday to sunday\n---\n\n- **Language for answers:**\n- **Time zone:** Not/AZone\nText.\n",
    );
    migrate();
    // A zone that Eva cannot use stays in its line, so nothing is lost.
    expect(read(aboutMe)).toBe(
      "---\nname: Alex\nunits: cubits\npinned: full # full, summary or false. full: Eva reads this whole note in every chat\n---\n\n- **Time zone:** Not/AZone\nText.\n",
    );
    expect(existsSync(join(vault, settingsFile))).toBe(false);
  });

  test("a pinned key that is there already stays as it is", () => {
    write(aboutMe, "---\nname: Alex\npinned: summary\nsummary: Alex\n---\n\nText.\n");
    migrate();
    expect(read(aboutMe)).toBe("---\nname: Alex\npinned: summary\nsummary: Alex\n---\n\nText.\n");
  });

  test("keeps Windows line endings and a byte order mark", () => {
    write(
      aboutMe,
      "\uFEFF---\r\nname: Alex\r\nclock: 12h\r\n---\r\n\r\n- **Language for answers:** Spanish\r\nText.\r\n",
    );
    migrate();
    expect(read(aboutMe)).toBe(
      "\uFEFF---\r\nname: Alex\r\npinned: full # full, summary or false. full: Eva reads this whole note in every chat\r\n---\r\n\r\nText.\r\n",
    );
    expect(settings()).toEqual({ clock: "12h", language: "Spanish" });
  });

  test("a note with no header gets one with the pin", () => {
    write(aboutMe, "# About Alex\n");
    migrate();
    expect(read(aboutMe)).toBe(
      "---\npinned: full # full, summary or false. full: Eva reads this whole note in every chat\n---\n# About Alex\n",
    );
  });

  test("a missing note is done, and a broken header waits for its repair", () => {
    expect(migrate()).toMatchObject({ kind: "done", later: [] });
    expect(existsSync(join(vault, aboutMe))).toBe(false);
    recordSettingsFolder();
    const broken = "---\nname: [Alex\nclock: 12h\n---\n\n- **Language for answers:** Spanish\n";
    write(aboutMe, broken);
    expect(migrate()).toMatchObject({ kind: "done", later: ["2026-11-03-format-settings"] });
    expect(read(aboutMe)).toBe(broken);
    expect(existsSync(join(vault, settingsFile))).toBe(false);
  });

  test("waits for the settings folder migration, so the old settings file is never hidden or cut", () => {
    rmSync(join(vault, ".eva", "migrations.json"));
    const old = JSON.stringify({ timeZone: "Asia/Tokyo", sync: { sweepSeconds: 30 } });
    write(".eva/settings.json", old);
    write(aboutMe, oldNote);
    // The settings folder migration waited, as it does for an old file that Eva cannot read yet.
    expect(migrate([moveFormatSettings])).toMatchObject({ kind: "done", later: ["2026-11-03-format-settings"] });
    expect(read(".eva/settings.json")).toBe(old);
    expect(existsSync(join(vault, settingsFile))).toBe(false);
    expect(read(aboutMe)).toBe(oldNote);
    // Even when the record lists it, a vault whose settings are only in the old place waits.
    recordSettingsFolder();
    expect(migrate()).toMatchObject({ later: ["2026-11-03-format-settings"] });
    expect(read(".eva/settings.json")).toBe(old);
  });

  test("after the settings folder migration in the same run, every old setting stays", () => {
    rmSync(join(vault, ".eva", "migrations.json"));
    write(".eva/settings.json", JSON.stringify({ timeZone: null, sync: { sweepSeconds: 30 } }));
    write(aboutMe, oldNote);
    expect(migrate()).toMatchObject({ applied: ["2026-10-30-settings-folder", "2026-11-03-format-settings"] });
    expect(settings()).toMatchObject({ timeZone: "Europe/Madrid", sync: { sweepSeconds: 30 }, clock: "12h" });
    expect(JSON.parse(read(".eva/settings.json"))).toEqual(settings());
  });

  test("an unknown time zone line stays while the setting is empty, and leaves once the setting holds one", () => {
    write(aboutMe, "---\nname: Alex\n---\n\n- **Time zone:** Madrid time\n- **Language for answers:** Spanish\n");
    migrate();
    expect(read(aboutMe)).toContain("- **Time zone:** Madrid time\n");
    expect(settings()).toEqual({ language: "Spanish" });
    recordSettingsFolder();
    write(settingsFile, JSON.stringify({ timeZone: "Europe/Madrid" }));
    write(aboutMe, "---\nname: Alex\npinned: full\n---\n\n- **Time zone:** Madrid time\n");
    migrate();
    expect(read(aboutMe)).not.toContain("Time zone");
  });

  test("a comment line under a removed field stays", () => {
    write(aboutMe, "---\nname: Alex\nclock: 12h\n  # the next field is the places\nplaces:\n---\n");
    migrate();
    expect(read(aboutMe)).toStartWith("---\nname: Alex\n  # the next field is the places\nplaces:\n");
  });

  test("a broken settings file waits", () => {
    write(aboutMe, oldNote);
    write(settingsFile, "{ not json");
    expect(migrate()).toMatchObject({ kind: "done", later: ["2026-11-03-format-settings"] });
    expect(read(aboutMe)).toBe(oldNote);
  });

  test("the old settings place gets the same values while it exists", () => {
    write(aboutMe, oldNote);
    write(".eva/settings.json", "{}");
    write(settingsFile, "{}");
    migrate();
    expect(JSON.parse(read(".eva/settings.json"))).toEqual(settings());
  });

  test("creates no note or folder in Life/", () => {
    write(aboutMe, oldNote);
    migrate();
    expect(readdirSync(join(vault, "Life"))).toEqual(["About me.md"]);
  });
});
