import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocationStore } from "../../../../src/core/location/last-location.ts";

let root: string;
let file: string;
let clock: Date;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-location-"));
  mkdirSync(join(root, "state"), { recursive: true });
  file = join(root, "state", "location.json");
  clock = new Date("2026-10-22T08:00:00.000Z");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function store(): LocationStore {
  return new LocationStore({ path: file, now: () => clock });
}

const here = { lat: 41.39, lon: 2.17, accuracy: 20 };

function minutes(count: number): Date {
  return new Date(Date.parse("2026-10-22T08:00:00.000Z") + count * 60_000);
}

describe("LocationStore", () => {
  test("keeps the location with the time when the phone took it, and its source", () => {
    expect(store().save(here, "telegram", minutes(-2), true)).toBe(true);
    expect(store().read()).toEqual({ ...here, at: minutes(-2).toISOString(), source: "telegram" });
  });

  test("keeps a live stream at most once a minute, and a shared point always", () => {
    store().save(here, "telegram", minutes(-5), true);
    expect(store().save({ ...here, lat: 41.4 }, "telegram", minutes(-4.5), false)).toBe(false);
    expect(store().save({ ...here, lat: 41.41 }, "telegram", minutes(-4), false)).toBe(true);
    expect(store().save({ ...here, lat: 40.4 }, "web", minutes(-3.9), true)).toBe(true);
    expect(store().read()).toMatchObject({ lat: 40.4, source: "web" });
  });

  test("drops a point older than the kept one, such as a backlog after a restart", () => {
    store().save(here, "telegram", minutes(-1), true);
    expect(store().save({ ...here, lat: 1 }, "telegram", minutes(-60), true)).toBe(false);
    expect(store().read()?.lat).toBe(41.39);
  });

  test("takes a time in the future as now, so a fast phone clock blocks nothing", () => {
    store().save(here, "web", minutes(30), true);
    expect(store().read()?.at).toBe(clock.toISOString());
    clock = minutes(2);
    expect(store().save({ ...here, lat: 1 }, "web", minutes(2), false)).toBe(true);
  });

  test("refuses a point that is not on the Earth", () => {
    expect(store().save({ lat: 91, lon: 0, accuracy: null }, "web", clock, true)).toBe(false);
    expect(store().save({ lat: 0, lon: 181, accuracy: null }, "web", clock, true)).toBe(false);
    expect(store().save({ lat: Number.NaN, lon: 0, accuracy: null }, "web", clock, true)).toBe(false);
    expect(store().read()).toBeNull();
  });

  test("reads a missing or damaged file as no location", () => {
    expect(store().read()).toBeNull();
    writeFileSync(file, "{ broken");
    expect(store().read()).toBeNull();
  });
});
