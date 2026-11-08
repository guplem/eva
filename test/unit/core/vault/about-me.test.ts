import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aboutMeHeaderKeys,
  aboutMeProblemNote,
  firstCommitDay,
  installedOn,
  parseLastLocation,
  readAboutMe,
  readHomePlace,
  readLastLocation,
  readOldFormatFields,
  withHeaderField,
} from "../../../../src/core/vault/about-me.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";
import { vaultTemplateFiles } from "../../../../src/core/vault/vault-template.ts";

const point = {
  latitude: 37.77,
  longitude: -122.42,
  accuracy: 30,
  at: "2026-10-22T08:00:00.000Z",
  source: "telegram",
} as const;
const pointLine =
  'lastLocation: { latitude: 37.77, longitude: -122.42, accuracy: 30, at: "2026-10-22T08:00:00.000Z", source: telegram }';

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-about-me-"));
  mkdirSync(join(vault, "Life"), { recursive: true });
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

/** Records the format migration in the vault, as the hub does at start. */
function recordFormatMigration(): void {
  mkdirSync(join(vault, ".eva"), { recursive: true });
  writeFileSync(
    join(vault, ".eva", "migrations.json"),
    JSON.stringify({ applied: [{ id: "2026-11-03-format-settings", at: "", version: "1.50.0" }] }),
  );
}

function note(header: string, body = "# About Alex\n"): void {
  writeFileSync(join(vault, "Life", "About me.md"), `---\n${header}\n---\n\n${body}`);
}

describe("readAboutMe", () => {
  test("reads the facts that code uses", () => {
    note(
      [
        "name: Alex",
        "birthDate: 1990-05-14",
        "region: US-CA",
        "hemisphere: north",
        "sleep:",
        '  from: "23:30"',
        '  to: "07:30"',
      ].join("\n"),
    );
    expect(readAboutMe(vault)).toEqual({
      name: "Alex",
      birthDate: "1990-05-14",
      region: "US-CA",
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
      "region must be a country code, such as US, or a region code, such as US-CA.",
      "hemisphere must be north or south.",
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

describe("the home region and the hemisphere (vault structure v7)", () => {
  test("reads the region of the home place, and the hemisphere from its latitude", () => {
    note(
      [
        "name: Alex",
        "aliases: [Lex]",
        "places:",
        "  home: { city: Sydney, region: AU-NSW, lat: -33.87, lon: 151.21 }",
        "work:",
        '  - { period: Life/Periods/2024-09-01-example-job, from: "09:00", to: "17:00", days: [mon, tue] }',
        '  - { period: Life/Periods/2025-02-01-example-study, from: "18:00", to: "21:00" }',
      ].join("\n"),
    );
    expect(readAboutMe(vault)).toEqual({
      name: "Alex",
      birthDate: null,
      region: "AU-NSW",
      hemisphere: "south",
      problems: [],
    });
  });

  test("prefers the home region to the old top-level region", () => {
    note("region: US\nplaces:\n  home: { region: US-CA }");
    expect(readAboutMe(vault).region).toBe("US-CA");
  });

  test("still reads the old top-level region and hemisphere", () => {
    note("region: AR\nhemisphere: south");
    expect(readAboutMe(vault)).toMatchObject({ region: "AR", hemisphere: "south", problems: [] });
  });

  test("prefers the old hemisphere to the one from the latitude", () => {
    note("hemisphere: north\nplaces:\n  home: { lat: -33.87, lon: 151.21 }");
    expect(readAboutMe(vault).hemisphere).toBe("north");
  });

  test("takes the hemisphere from the last location when the home has no latitude", () => {
    note(
      'places:\n  home: { city: Example }\nlastLocation: { latitude: -34.6, longitude: -58.4, accuracy: 30, at: "2026-10-22T08:00:00.000Z", source: web }',
    );
    expect(readAboutMe(vault).hemisphere).toBe("south");
    note('lastLocation: { latitude: 40.4, longitude: -3.7, at: "2026-10-22T08:00:00.000Z", source: web }');
    expect(readAboutMe(vault).hemisphere).toBe("north");
  });

  test("puts the equator in the north, and knows no hemisphere without a point", () => {
    note("places:\n  home: { lat: 0, lon: 10 }");
    expect(readAboutMe(vault).hemisphere).toBe("north");
    note("places:\n  home: { lat: far, lon: 10 }");
    expect(readAboutMe(vault).hemisphere).toBeNull();
  });

  test("names the bad home region by its own key, and falls back to the old region", () => {
    note("region: US\nplaces:\n  home: { region: California }");
    const read = readAboutMe(vault);
    expect(read.region).toBe("US");
    expect(read.problems).toEqual([
      "places.home.region must be a country code, such as US, or a region code, such as US-CA.",
    ]);
  });

  test("checks the hours of each job in the work list", () => {
    note('work:\n  - { period: Life/Periods/a, from: "09:00", to: "17:00" }\n  - { period: Life/Periods/b, to: late }');
    expect(readAboutMe(vault).problems).toEqual(["work[1].to must be a time as HH:mm."]);
    note("work:\n  - Life/Periods/a");
    expect(readAboutMe(vault).problems).toEqual(["work[0] must have a period, and from and to times."]);
    note("work: nine to five");
    expect(readAboutMe(vault).problems).toEqual(["work must be a list of jobs, each with from and to times."]);
  });

  test("still checks the hours of the old work map", () => {
    note('work: { period: Life/Periods/a, from: "9am", to: "17:00" }');
    expect(readAboutMe(vault).problems).toEqual(["work.from must be a time as HH:mm."]);
  });
});

describe("the format fields that moved to the settings (#770)", () => {
  test("before the hub migrates the vault, they raise no problem, also with a bad value", () => {
    note("clock: 12h\nunits: cubits\nweekStart: someday");
    expect(readAboutMe(vault).problems).toEqual([]);
  });

  test("after the migration, each one in the header names the setting where it belongs now", () => {
    recordFormatMigration();
    note("name: Alex\nclock: 12h\nweekStart:");
    expect(readAboutMe(vault).problems).toEqual([
      "clock is an Eva setting now. When the setting is not set, set it with eva settings set clock; when it holds another value, ask the person which one is right first. Then remove the field from this note.",
      "weekStart is an Eva setting now. When the setting is not set, set it with eva settings set weekStart; when it holds another value, ask the person which one is right first. Then remove the field from this note.",
    ]);
  });

  test("the old personal fields stay valid until the vault upgrade", () => {
    recordFormatMigration();
    note(
      [
        'sleep: { from: "23:30", to: "07:30" }',
        "people:",
        "  - { name: Sam, relation: partner, birthDate: 1991-02-03 }",
        "dates:",
        "  - { name: Wedding anniversary, date: 2018-09-15 }",
        "diet: [vegetarian]",
        "allergies: [peanuts]",
        'work: { period: "[[Life/Periods/2024-01-08-example-job/Period]]" }',
        "contact: { email: alex@example.com }",
        "languages: [English (native)]",
      ].join("\n"),
    );
    expect(readAboutMe(vault).problems).toEqual([]);
    note("people:\n  - { name: Sam, birthDate: soon }");
    expect(readAboutMe(vault).problems).toEqual([
      "people[0].birthDate must be a date as YYYY-MM-DD, or --MM-DD without the year.",
    ]);
  });
});

describe("readOldFormatFields", () => {
  test("reads the valid units, clock and week start of the header", () => {
    note("units: imperial\nclock: 12h\nweekStart: sunday", "# About Alex\n\n- **Language for answers:** Spanish\r\n");
    expect(readOldFormatFields(vault)).toEqual({
      language: "Spanish",
      units: "imperial",
      clock: "12h",
      weekStart: "sunday",
    });
  });

  test("reads a bad, empty or missing one as null", () => {
    note("units: cubits\nclock:", "- **Language for answers:**\n");
    expect(readOldFormatFields(vault)).toEqual({ language: null, units: null, clock: null, weekStart: null });
    rmSync(join(vault, "Life", "About me.md"));
    expect(readOldFormatFields(vault)).toEqual({ language: null, units: null, clock: null, weekStart: null });
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
      notesLanguage: "English",
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

  test("has only keys that the about-me skill describes, and none of the old ones", () => {
    const text = vaultTemplateFiles({ name: "Alex", notesLanguage: "English", topics: [] })["Life/About me.md"] ?? "";
    const keys = [...(text.split("\n---")[0] ?? "").matchAll(/^([A-Za-z]+):/gm)].map((match) => match[1]);
    expect(keys).toContain("aliases");
    for (const key of keys) expect(aboutMeHeaderKeys).toContain(key as (typeof aboutMeHeaderKeys)[number]);
    for (const old of ["nickname", "region", "hemisphere"]) expect(keys).not.toContain(old);
  });

  test("has an empty lastLocation that Eva fills in place", () => {
    const text = vaultTemplateFiles({
      name: "Alex",
      notesLanguage: "English",
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
    note("places:\n  home: { city: San Francisco, lat: 37.77, lon: -122.42 }");
    expect(readHomePlace(vault)).toEqual({ lat: 37.77, lon: -122.42 });
  });

  test("is null with no point, a bad point, broken YAML or no header", () => {
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { city: San Francisco }");
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { lat: 141, lon: 2 }");
    expect(readHomePlace(vault)).toBeNull();
    note("places:\n  home: { city: San Francisco, lat: , lon: '' }");
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
    const text = `---\nname: Alex # the short name\nlastLocation: # Eva fills this\nplaces:\n  home: { city: San Francisco }\n---\n${body}`;
    expect(withHeaderField(text, "lastLocation", pointLine)).toBe(
      `---\nname: Alex # the short name\n${pointLine}\nplaces:\n  home: { city: San Francisco }\n---\n${body}`,
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
