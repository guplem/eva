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

describe("LocationStore", () => {
  test("keeps the newest location with its time and source", () => {
    expect(store().save(here, "telegram")).toBe(true);
    expect(store().read()).toEqual({ ...here, at: "2026-10-22T08:00:00.000Z", source: "telegram" });
  });

  test("writes at most every 15 minutes", () => {
    store().save(here, "telegram");
    clock = new Date("2026-10-22T08:10:00.000Z");
    expect(store().save({ ...here, lat: 41.4 }, "telegram")).toBe(false);
    expect(store().read()?.lat).toBe(41.39);
    clock = new Date("2026-10-22T08:15:00.000Z");
    expect(store().save({ ...here, lat: 41.4 }, "web")).toBe(true);
    expect(store().read()).toMatchObject({ lat: 41.4, source: "web" });
  });

  test("refuses a point that is not on the Earth", () => {
    expect(store().save({ lat: 91, lon: 0, accuracy: null }, "web")).toBe(false);
    expect(store().save({ lat: 0, lon: 181, accuracy: null }, "web")).toBe(false);
    expect(store().save({ lat: Number.NaN, lon: 0, accuracy: null }, "web")).toBe(false);
    expect(store().read()).toBeNull();
  });

  test("reads a missing or damaged file as no location", () => {
    expect(store().read()).toBeNull();
    writeFileSync(file, "{ broken");
    expect(store().read()).toBeNull();
  });
});
