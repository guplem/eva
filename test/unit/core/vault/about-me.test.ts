import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aboutMeProblemNote, installedOn, readAboutMe } from "../../../../src/core/vault/about-me.ts";
import { vaultTemplateFiles } from "../../../../src/core/vault/vault-template.ts";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-about-me-"));
  mkdirSync(join(vault, "Life"), { recursive: true });
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function note(header: string, body = "# About Alex\n"): void {
  writeFileSync(join(vault, "Life", "About me.md"), `---\n${header}\n---\n\n${body}`);
}

describe("readAboutMe", () => {
  test("reads the facts that code uses", () => {
    note(
      [
        "name: Alex",
        "birthDate: 1990-05-14",
        "region: ES-CT",
        "hemisphere: north",
        "sleep:",
        '  from: "23:30"',
        '  to: "07:30"',
      ].join("\n"),
    );
    expect(readAboutMe(vault)).toEqual({
      name: "Alex",
      birthDate: "1990-05-14",
      region: "ES-CT",
      hemisphere: "north",
      problems: [],
    });
  });

  test("reads an empty field as unknown, with no problem", () => {
    note("name:\nbirthDate:\nregion:\nhemisphere:");
    expect(readAboutMe(vault)).toEqual({ name: null, birthDate: null, region: null, hemisphere: null, problems: [] });
  });

  test("reads a missing note or a note with no header as unknown", () => {
    expect(readAboutMe(vault).birthDate).toBeNull();
    writeFileSync(join(vault, "Life", "About me.md"), "# About Alex\n\n- **Name:** Alex\n");
    expect(readAboutMe(vault)).toMatchObject({ name: null, problems: [] });
  });

  test("ignores each bad field and names it, so Eva can fix it", () => {
    note(
      [
        "birthDate: 14 May 1990",
        "region: Catalonia",
        "hemisphere: up",
        "clock: 25h",
        "units: cubits",
        "weekStart: someday",
        "sleep:",
        "  from: late",
        "places: home",
        "people:",
        "  - name: Sam",
        "    birthDate: soon",
        "dates:",
        "  - name: Wedding",
        "diet: vegetarian",
      ].join("\n"),
    );
    const read = readAboutMe(vault);
    expect(read.birthDate).toBeNull();
    expect(read.region).toBeNull();
    expect(read.hemisphere).toBeNull();
    expect(read.problems).toEqual([
      "birthDate must be a date as YYYY-MM-DD.",
      "region must be a country code, such as ES, or a region code, such as ES-CT.",
      "hemisphere must be north or south.",
      "clock must be 12h or 24h.",
      "units must be metric or imperial.",
      "weekStart must be a day, such as monday.",
      "sleep.from must be a time as HH:mm.",
      "places must be a set of named places.",
      "people[0].birthDate must be a date as YYYY-MM-DD.",
      "dates[0].date must be a date as YYYY-MM-DD.",
      "diet must be a list.",
    ]);
  });

  test("names broken YAML as one problem", () => {
    note("name: [Alex");
    expect(readAboutMe(vault).problems).toEqual(["The header of Life/About me.md is not valid YAML."]);
  });

  test("rejects a date that does not exist", () => {
    note("birthDate: 1990-02-30");
    expect(readAboutMe(vault).problems).toEqual(["birthDate must be a date as YYYY-MM-DD."]);
  });
});

describe("aboutMeProblemNote", () => {
  test("asks Eva to fix the problems with the about-me skill", () => {
    expect(aboutMeProblemNote(["hemisphere must be north or south."])).toBe(
      "[Life/About me.md has problems: hemisphere must be north or south. Fix them with the about-me skill.]",
    );
    expect(aboutMeProblemNote([])).toBeNull();
  });
});

describe("installedOn", () => {
  test("is the day of the vault's first migration", () => {
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(
      join(vault, ".eva", "migrations.json"),
      JSON.stringify({
        applied: [
          { id: "b", at: "2026-10-21T10:00:00.000Z", version: "0.4.0" },
          { id: "a", at: "2025-03-02T09:00:00.000Z", version: "0.1.0" },
        ],
      }),
    );
    expect(installedOn(vault)).toBe("2025-03-02");
  });

  test("is null without a record, or with a damaged one", () => {
    expect(installedOn(vault)).toBeNull();
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(join(vault, ".eva", "migrations.json"), "{ broken");
    expect(installedOn(vault)).toBeNull();
  });
});

describe("a new vault's note", () => {
  test("reads with the name and no problem", () => {
    const files = vaultTemplateFiles({ name: 'Alex "Lex" Example', language: "English", timeZone: "UTC", topics: [] });
    writeFileSync(join(vault, "Life", "About me.md"), files["Life/About me.md"] ?? "");
    expect(readAboutMe(vault)).toEqual({
      name: 'Alex "Lex" Example',
      birthDate: null,
      region: null,
      hemisphere: null,
      problems: [],
    });
  });
});
