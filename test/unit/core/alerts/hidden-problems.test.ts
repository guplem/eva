import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHiddenProblems, writeHiddenProblems } from "../../../../src/core/alerts/hidden-problems.ts";

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-hidden-"));
  path = join(folder, "state", "hidden-problems.json");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("hidden problems file", () => {
  test("keeps the marks across a write and a read", () => {
    writeHiddenProblems(path, { update: "warn", "machine:laptop:update": "error" });
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
      hidden: { update: "warn", "machine:laptop:update": "error" },
    });
    expect(readHiddenProblems(path)).toEqual({ update: "warn", "machine:laptop:update": "error" });
  });

  test("a missing or broken file hides nothing", () => {
    expect(readHiddenProblems(path)).toEqual({});
    writeHiddenProblems(path, {});
    writeFileSync(path, "{ not json");
    expect(readHiddenProblems(path)).toEqual({});
    writeFileSync(path, JSON.stringify({ hidden: "update" }));
    expect(readHiddenProblems(path)).toEqual({});
    writeFileSync(path, "null");
    expect(readHiddenProblems(path)).toEqual({});
  });

  test("a mark with an unknown level is skipped, and the others stay", () => {
    writeHiddenProblems(path, {});
    writeFileSync(path, JSON.stringify({ hidden: { update: "warn", vault_sync: "loud", schedule: 3 } }));
    expect(readHiddenProblems(path)).toEqual({ update: "warn" });
  });
});
