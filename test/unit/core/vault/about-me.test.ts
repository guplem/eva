import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aboutMeProblemNote,
  firstCommitDay,
  installedOn,
  parseLastLocation,
  readAboutMe,
  readHomePlace,
  readLastLocation,
  withHeaderField,
} from "../../../../src/core/vault/about-me.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { vaultTemplateFiles } from "../../../../src/core/vault/vault-template.ts";

const point = {
  latitude: 41.39,
  longitude: 2.17,
  accuracy: 30,
  at: "2026-10-22T08:00:00.000Z",
  source: "telegram",
} as const;
const pointLine =
  'lastLocation: { latitude: 41.39, longitude: 2.17, accuracy: 30, at: "2026-10-22T08:00:00.000Z", source: telegram }';

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
      "birthDate must be a date as YYYY-MM-DD, or --MM-DD without the year.",
      "region must be a country code, such as ES, or a region code, such as ES-CT.",
      "hemisphere must be north or south.",
      "clock must be 12h or 24h.",
      "units must be metric or imperial.",
      "weekStart must be a day, such as monday.",
      "sleep.from must be a time as HH:mm.",
      "places must be a set of named places.",
      "people[0].birthDate must be a date as YYYY-MM-DD, or --MM-DD without the year.",
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
    expect(readAboutMe(vault).problems).toEqual([
      "birthDate must be a date as YYYY-MM-DD, or --MM-DD without the year.",
    ]);
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
    expect(installedOn(vault, null)).toBe("2025-03-02");
    // The first commit of an older vault comes before the record.
    expect(installedOn(vault, "2024-01-09")).toBe("2024-01-09");
  });

  test("is null without a record, or with a damaged one", () => {
    expect(installedOn(vault, null)).toBeNull();
    expect(installedOn(vault, "2024-01-09")).toBe("2024-01-09");
    mkdirSync(join(vault, ".eva"), { recursive: true });
    writeFileSync(join(vault, ".eva", "migrations.json"), "{ broken");
    expect(installedOn(vault, null)).toBeNull();
  });
});

describe("a new vault's note", () => {
  test("reads with the name and no problem", () => {
    const files = vaultTemplateFiles({
      name: 'Alex "Lex" Example',
      language: "English",
      notesLanguage: "English",
      timeZone: "UTC",
      topics: [],
    });
    writeFileSync(join(vault, "Life", "About me.md"), files["Life/About me.md"] ?? "");
    expect(readAboutMe(vault)).toEqual({
      name: 'Alex "Lex" Example',
      birthDate: null,
      region: null,
      hemisphere: null,
      problems: [],
    });
  });

  test("has an empty lastLocation that Eva fills in place", () => {
    const text = vaultTemplateFiles({
      name: "Alex",
      language: "English",
      notesLanguage: "English",
      timeZone: "UTC",
      topics: [],
    })["Life/About me.md"];
    expect(parseLastLocation(text ?? "")).toBeNull();
    const filled = withHeaderField(text ?? "", "lastLocation", pointLine) ?? "";
    expect(parseLastLocation(filled)).toEqual(point);
    expect(filled.split("\n").length).toBe((text ?? "").split("\n").length);
  });
});

describe("forms that people write", () => {
  test("a person with no known birthday, empty lists and a birthday with no year are fine", () => {
    note(
      [
        "birthDate: --05-14",
        "people:",
        "  - { name: Sam, relation: partner }",
        "  - { name: Luna, relation: dog, birthDate: --08-01 }",
        "places: []",
        "diet: []",
        "sleep: {}",
      ].join("\n"),
    );
    expect(readAboutMe(vault)).toMatchObject({ birthDate: "--05-14", problems: [] });
  });

  test("a day with no year must still be a real day", () => {
    note("birthDate: --02-30");
    expect(readAboutMe(vault).problems).toEqual([
      "birthDate must be a date as YYYY-MM-DD, or --MM-DD without the year.",
    ]);
  });

  test("a byte order mark before the header does not hide it", () => {
    writeFileSync(join(vault, "Life", "About me.md"), "\uFEFF---\nname: Alex\n---\n");
    expect(readAboutMe(vault).name).toBe("Alex");
  });
});

describe("firstCommitDay", () => {
  function runner(exitCode: number, stdout: string): ProcessRunner {
    return { run: () => Promise.resolve({ exitCode, stdout, stderr: "" }) };
  }

  test("is the earliest root commit", async () => {
    expect(await firstCommitDay(vault, runner(0, "2024-05-02\n2023-11-30\n"), {})).toBe("2023-11-30");
  });

  test("is null when git fails or gives nothing", async () => {
    expect(await firstCommitDay(vault, runner(128, ""), {})).toBeNull();
    expect(await firstCommitDay(vault, runner(0, ""), {})).toBeNull();
  });
});

describe("readHomePlace", () => {
  test("reads the point of the home place", () => {
    note("places:\n  home: { city: Barcelona, lat: 41.39, lon: 2.17 }");
    expect(readHomePlace(vault)).toEqual({ lat: 41.39, lon: 2.17 });
  });

  test("is null with no point, a bad point, broken YAML or no header", () => {
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { city: Barcelona }");
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { lat: 141, lon: 2 }");
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { city: Barcelona, lat: , lon: '' }");
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { lat: 0x10, lon: [5] }");
    expect(readHomePlace(vault)).toBeNull();
    note("places: [home");
    expect(readHomePlace(vault)).toBeNull();
    writeFileSync(join(vault, "Life", "About me.md"), "# About Alex\n");
    expect(readHomePlace(vault)).toBeNull();
  });
});

describe("parseLastLocation", () => {
  test("reads the point that Eva wrote", () => {
    expect(parseLastLocation(`---\nname: Alex\n${pointLine}\n---\n`)).toEqual(point);
  });

  test("reads a point with no accuracy, also in block form", () => {
    const text = [
      "---",
      "lastLocation:",
      "  latitude: -33.9",
      "  longitude: 151.2",
      "  accuracy: null",
      '  at: "2026-10-22T08:00:00.000Z"',
      "  source: web",
      "---",
      "",
    ].join("\n");
    expect(parseLastLocation(text)).toEqual({
      ...point,
      latitude: -33.9,
      longitude: 151.2,
      accuracy: null,
      source: "web",
    });
  });

  test("is null for an empty field, a bad field, broken YAML or no header", () => {
    expect(parseLastLocation("---\nlastLocation: # Eva fills this\n---\n")).toBeNull();
    expect(
      parseLastLocation("---\nlastLocation: { latitude: 91, longitude: 2, at: x, source: web }\n---\n"),
    ).toBeNull();
    expect(parseLastLocation(`---\n${pointLine.replace("telegram", "carrier pigeon")}\n---\n`)).toBeNull();
    expect(parseLastLocation(`---\n${pointLine.replace("2026-10-22T08:00:00.000Z", "yesterday")}\n---\n`)).toBeNull();
    expect(parseLastLocation("---\nlastLocation: [1\n---\n")).toBeNull();
    expect(parseLastLocation("# About Alex\n")).toBeNull();
  });

  test("leaves a bad field out of the problems: the code fixes it at the next write", () => {
    note("lastLocation: { latitude: north }");
    expect(readAboutMe(vault).problems).toEqual([]);
  });

  test("reads the note of the vault", () => {
    note(pointLine);
    expect(readLastLocation(vault)).toEqual(point);
  });
});

describe("withHeaderField", () => {
  const body = "\n# About Alex\n\nlastLocation: in the text, not the header\n";

  test("replaces the field in place and keeps every other byte", () => {
    const text = `---\nname: Alex # the short name\nlastLocation: # Eva fills this\nplaces:\n  home: { city: Barcelona }\n---\n${body}`;
    expect(withHeaderField(text, "lastLocation", pointLine)).toBe(
      `---\nname: Alex # the short name\n${pointLine}\nplaces:\n  home: { city: Barcelona }\n---\n${body}`,
    );
  });

  test("replaces a field in block form with all its lines", () => {
    const text = `---\nlastLocation:\n  latitude: 1\n\n  longitude: 2\nname: Alex\n---\n${body}`;
    expect(withHeaderField(text, "lastLocation", pointLine)).toBe(`---\n${pointLine}\nname: Alex\n---\n${body}`);
  });

  test("adds a missing field at the end of the header, after its comment line", () => {
    expect(
      withHeaderField(`---\nname: Alex\ndiet: [vegetarian]\n---\n${body}`, "lastLocation", pointLine, "# Eva's line"),
    ).toBe(`---\nname: Alex\ndiet: [vegetarian]\n# Eva's line\n${pointLine}\n---\n${body}`);
  });

  test("replaces a list under the field at the same indent", () => {
    const text = "---\nlastLocation:\n- 1\n- 2\nname: Alex\n---\n";
    expect(withHeaderField(text, "lastLocation", pointLine)).toBe(`---\n${pointLine}\nname: Alex\n---\n`);
  });

  test("adds a header to a note with none", () => {
    expect(withHeaderField("# About Alex\n", "lastLocation", pointLine, "# Eva's line")).toBe(
      `---\n# Eva's line\n${pointLine}\n---\n# About Alex\n`,
    );
  });

  test("keeps Windows line endings and a byte order mark", () => {
    const text = "\uFEFF---\r\nname: Alex\r\n---\r\n\r\n# About Alex\r\n";
    expect(withHeaderField(text, "lastLocation", pointLine)).toBe(
      `\uFEFF---\r\nname: Alex\r\n${pointLine}\r\n---\r\n\r\n# About Alex\r\n`,
    );
  });

  test("keeps the line ending of the header, also when the text below has other ones", () => {
    const text = "---\nname: Alex\n---\r\n# About Alex\r\n";
    expect(withHeaderField(text, "lastLocation", pointLine)).toBe(
      `---\nname: Alex\n${pointLine}\n---\r\n# About Alex\r\n`,
    );
  });

  test("is null when the header is broken, so Eva never writes over it", () => {
    expect(withHeaderField("---\nplaces: [home\n---\n", "lastLocation", pointLine)).toBeNull();
  });

  test("is null when the new header would not read as the old one with the new field", () => {
    // The comment ends the field's lines for the replace, so its last line would stay behind.
    const text = "---\nlastLocation:\n  latitude: 1\n# a comment\n  longitude: 2\nname: Alex\n---\n";
    expect(withHeaderField(text, "lastLocation", pointLine)).toBeNull();
  });
});
