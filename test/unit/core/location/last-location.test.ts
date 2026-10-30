import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { distanceMeters, LocationKeeper } from "../../../../src/core/location/last-location.ts";
import { readLastLocation } from "../../../../src/core/vault/about-me.ts";

let root: string;
let vault: string;
let oldFile: string;
let note: string;
let clock: Date;

const start = Date.parse("2026-10-22T08:00:00.000Z");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-location-"));
  vault = join(root, "vault");
  mkdirSync(join(vault, "Life"), { recursive: true });
  mkdirSync(join(root, "state"), { recursive: true });
  oldFile = join(root, "state", "location.json");
  note = join(vault, "Life", "About me.md");
  writeFileSync(note, "---\nname: Alex\nlastLocation: # Eva fills this\n---\n\n# About Alex\n");
  clock = new Date(start);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function keeper(vaultPath: string | null = vault): LocationKeeper {
  return new LocationKeeper({ vaultPath, oldFilePath: oldFile, now: () => clock });
}

const here = { latitude: 41.39, longitude: 2.17, accuracy: 20 };

function minutes(count: number): Date {
  return new Date(start + count * 60_000);
}

/** A point about `meters` north of `here`: a degree of latitude is about 111 km. */
function north(meters: number): typeof here {
  return { ...here, latitude: here.latitude + meters / 111_195 };
}

describe("distanceMeters", () => {
  test("measures a short move on the Earth", () => {
    expect(Math.round(distanceMeters(here, north(100)))).toBe(100);
    expect(distanceMeters(here, here)).toBe(0);
  });
});

describe("LocationKeeper.keep", () => {
  test("keeps the point in memory with the time when the phone took it, and its source", () => {
    const kept = keeper();
    expect(kept.keep(here, "telegram", minutes(-2), true)).toBe(true);
    expect(kept.newest()).toEqual({ ...here, at: minutes(-2).toISOString(), source: "telegram" });
    expect(readLastLocation(vault)).toBeNull();
  });

  test("keeps a live stream at most once a minute, and a shared point always", () => {
    const kept = keeper();
    kept.keep(here, "telegram", minutes(-5), true);
    expect(kept.keep(north(10), "telegram", minutes(-4.5), false)).toBe(false);
    expect(kept.keep(north(20), "telegram", minutes(-4), false)).toBe(true);
    expect(kept.keep({ ...here, latitude: 40.4 }, "web", minutes(-3.9), true)).toBe(true);
    expect(kept.newest()).toMatchObject({ latitude: 40.4, source: "web" });
  });

  test("drops a point older than the newest one, also than the note's", () => {
    const first = keeper();
    first.keep(here, "telegram", minutes(-1), true);
    first.writeIfDue();
    const kept = keeper();
    expect(kept.keep({ ...here, latitude: 1 }, "telegram", minutes(-60), true)).toBe(false);
    expect(kept.newest()?.latitude).toBe(41.39);
  });

  test("takes a time in the future as now, so a fast phone clock blocks nothing", () => {
    const kept = keeper();
    kept.keep(here, "web", minutes(30), true);
    expect(kept.newest()?.at).toBe(clock.toISOString());
    clock = minutes(2);
    expect(kept.keep({ ...here, latitude: 1 }, "web", minutes(2), false)).toBe(true);
  });

  test("refuses a point that is not on the Earth", () => {
    const kept = keeper();
    expect(kept.keep({ latitude: 91, longitude: 0, accuracy: null }, "web", clock, true)).toBe(false);
    expect(kept.keep({ latitude: 0, longitude: 181, accuracy: null }, "web", clock, true)).toBe(false);
    expect(kept.keep({ latitude: Number.NaN, longitude: 0, accuracy: null }, "web", clock, true)).toBe(false);
    expect(kept.keep({ ...here, accuracy: Number.POSITIVE_INFINITY }, "web", clock, true)).toBe(false);
    expect(kept.newest()).toBeNull();
  });
});

describe("LocationKeeper.writeIfDue", () => {
  test("writes the first point into the header in place, and keeps the rest of the note", () => {
    const kept = keeper();
    kept.keep(here, "telegram", minutes(-1), true);
    expect(kept.writeIfDue()).toBe("written");
    expect(readFileSync(note, "utf-8")).toBe(
      "---\nname: Alex\n" +
        `lastLocation: { latitude: 41.39, longitude: 2.17, accuracy: 20, at: "${minutes(-1).toISOString()}", source: telegram }\n` +
        "---\n\n# About Alex\n",
    );
    expect(keeper().newest()).toEqual({ ...here, at: minutes(-1).toISOString(), source: "telegram" });
  });

  test("writes nothing with no new point", () => {
    expect(keeper().writeIfDue()).toBe("nothing");
  });

  test("writes at most once every 15 minutes, also on a car trip", () => {
    const kept = keeper();
    kept.keep(here, "telegram", clock, true);
    expect(kept.writeIfDue()).toBe("written");
    clock = minutes(14);
    kept.keep(north(5_000), "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("waiting");
    expect(readLastLocation(vault)?.latitude).toBe(41.39);
    // The hub knows the newer point before it writes it.
    expect(kept.newest()?.latitude).toBe(north(5_000).latitude);
    clock = minutes(15);
    kept.keep(north(6_000), "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("written");
    expect(readLastLocation(vault)?.latitude).toBe(north(6_000).latitude);
  });

  test("writes a point in the same place only when the stored time is more than 6 hours old", () => {
    const kept = keeper();
    kept.keep(here, "telegram", clock, true);
    kept.writeIfDue();
    clock = minutes(6 * 60);
    kept.keep(north(30), "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("not_due");
    clock = minutes(6 * 60 + 1);
    kept.keep(north(30), "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("written");
    expect(readLastLocation(vault)?.at).toBe(clock.toISOString());
  });

  test("needs a move larger than the error radius of the new point, so an indoor jump writes nothing", () => {
    const kept = keeper();
    kept.keep(here, "telegram", clock, true);
    kept.writeIfDue();
    clock = minutes(30);
    kept.keep({ ...north(100), accuracy: 150 }, "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("not_due");
    clock = minutes(31);
    kept.keep({ ...north(100), accuracy: null }, "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("written");
  });

  test("writes nothing when the note has a newer point, such as from an older run", () => {
    const kept = keeper();
    kept.keep(here, "telegram", minutes(-10), true);
    const other = keeper();
    other.keep(north(500), "web", minutes(-5), true);
    other.writeIfDue();
    expect(kept.writeIfDue()).toBe("nothing");
    expect(readLastLocation(vault)?.source).toBe("web");
  });

  test("says that the note is fine when a point waits for a rule", () => {
    const kept = keeper();
    kept.keep(here, "telegram", clock, true);
    kept.writeIfDue();
    clock = minutes(20);
    kept.keep(north(10), "telegram", clock, false);
    expect(kept.writeIfDue()).toBe("not_due");
  });

  test("puts a comment line before a new field, so a change of the line above it does not conflict", () => {
    writeFileSync(note, "---\nname: Alex\nallergies: []\n---\n");
    const kept = keeper();
    kept.keep(here, "telegram", clock, true);
    kept.writeIfDue();
    const lines = readFileSync(note, "utf-8").split("\n");
    expect(lines[2]).toBe("allergies: []");
    expect(lines[3]).toStartWith("#");
    expect(lines[4]).toStartWith("lastLocation: ");
  });

  test("says why when the note is missing or its header is broken, and writes when it is fixed", () => {
    const kept = keeper();
    kept.keep(here, "telegram", clock, true);
    rmSync(note);
    expect(kept.writeIfDue()).toBe("no_note");
    writeFileSync(note, "---\nplaces: [home\n---\n");
    expect(kept.writeIfDue()).toBe("broken_note");
    expect(readFileSync(note, "utf-8")).toBe("---\nplaces: [home\n---\n");
    writeFileSync(note, "# About Alex\n");
    expect(kept.writeIfDue()).toBe("written");
    expect(readLastLocation(vault)?.latitude).toBe(41.39);
  });

  test("waits with no alert while the vault folder is not there yet, such as before its clone", () => {
    const kept = keeper(join(root, "not-cloned-yet"));
    kept.keep(here, "telegram", clock, true);
    expect(kept.writeIfDue()).toBe("waiting");
  });

  test("keeps the point in memory with no vault", () => {
    const kept = keeper(null);
    kept.keep(here, "telegram", clock, true);
    expect(kept.writeIfDue()).toBe("waiting");
    expect(kept.newest()?.latitude).toBe(41.39);
  });
});

describe("LocationKeeper and a time in the future", () => {
  test("reads a stored time in the future as old, so it blocks no new point, also in the same place", () => {
    writeFileSync(
      note,
      '---\nlastLocation: { latitude: 41.39, longitude: 2.17, accuracy: 20, at: "2026-10-22T10:00:00.000Z", source: web }\n---\n',
    );
    const kept = keeper();
    expect(kept.keep(here, "telegram", minutes(-1), false)).toBe(true);
    expect(kept.newest()?.source).toBe("telegram");
    expect(kept.writeIfDue()).toBe("written");
    expect(readLastLocation(vault)).toMatchObject({ source: "telegram", at: minutes(-1).toISOString() });
  });
});

describe("LocationKeeper and the file of an older Eva", () => {
  function writeOldFile(at: Date): void {
    writeFileSync(oldFile, JSON.stringify({ lat: 40.4, lon: -3.7, accuracy: 12, at: at.toISOString(), source: "web" }));
  }

  test("moves the old point into the note, and removes the old file", () => {
    writeOldFile(minutes(-90));
    expect(keeper().writeIfDue()).toBe("written");
    expect(readLastLocation(vault)).toEqual({
      latitude: 40.4,
      longitude: -3.7,
      accuracy: 12,
      at: minutes(-90).toISOString(),
      source: "web",
    });
    expect(existsSync(oldFile)).toBe(false);
  });

  test("keeps the note's point when it is newer, and still removes the old file", () => {
    const first = keeper();
    first.keep(here, "telegram", minutes(-5), true);
    first.writeIfDue();
    writeOldFile(minutes(-90));
    expect(keeper().writeIfDue()).toBe("nothing");
    expect(readLastLocation(vault)?.source).toBe("telegram");
    expect(existsSync(oldFile)).toBe(false);
  });

  test("keeps the old file while the note is missing", () => {
    writeOldFile(minutes(-90));
    rmSync(note);
    const kept = keeper();
    expect(kept.writeIfDue()).toBe("no_note");
    expect(existsSync(oldFile)).toBe(true);
  });

  test("ignores a damaged old file", () => {
    writeFileSync(oldFile, "{ broken");
    expect(keeper().writeIfDue()).toBe("nothing");
  });
});
