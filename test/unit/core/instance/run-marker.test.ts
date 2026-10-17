import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearRunMarker, startRunMarker } from "../../../../src/core/instance/run-marker.ts";

let folder: string;
let marker: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-run-marker-"));
  marker = join(folder, "state", "running");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("startRunMarker", () => {
  test("a first start writes the marker and finds no unclean exit", () => {
    expect(startRunMarker(marker, new Date("2026-10-17T10:00:00Z"))).toBe(false);
    expect(existsSync(marker)).toBe(true);
  });

  test("a start after a clean stop finds no unclean exit", () => {
    startRunMarker(marker, new Date("2026-10-17T10:00:00Z"));
    clearRunMarker(marker);
    expect(existsSync(marker)).toBe(false);
    expect(startRunMarker(marker, new Date("2026-10-17T11:00:00Z"))).toBe(false);
  });

  test("a start that finds the marker of an earlier run reports an unclean exit", () => {
    startRunMarker(marker, new Date("2026-10-17T10:00:00Z"));
    expect(startRunMarker(marker, new Date("2026-10-17T11:00:00Z"))).toBe(true);
  });
});

describe("clearRunMarker", () => {
  test("a missing marker is no error", () => {
    expect(() => {
      clearRunMarker(marker);
    }).not.toThrow();
  });
});
