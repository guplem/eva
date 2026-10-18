import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonTolerant, readTextTolerant, writeFileAtomic } from "../../../src/shared/files.ts";

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-files-"));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  test("writes the content and leaves no temporary file behind", () => {
    const path = join(folder, "state", "sessions.json");
    writeFileAtomic(path, "first");
    writeFileAtomic(path, "second");
    expect(Bun.file(path).size).toBe(6);
    expect(readdirSync(join(folder, "state"))).toEqual(["sessions.json"]);
  });
});

describe("readJsonTolerant", () => {
  test("returns the parsed value", () => {
    const path = join(folder, "a.json");
    writeFileSync(path, '{"version":1}');
    expect(readJsonTolerant(path)).toEqual({ ok: true, value: { version: 1 } });
  });

  test("reports a missing file without throwing", () => {
    expect(readJsonTolerant(join(folder, "missing.json"))).toEqual({ ok: false, reason: "missing" });
  });

  test("reports a broken file without throwing (lesson 54)", () => {
    const path = join(folder, "broken.json");
    writeFileSync(path, "{not json");
    const result = readJsonTolerant(path);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toBe("invalid");
    expect(existsSync(path)).toBe(true);
  });

  test("never throws on deeply nested JSON (lesson 69)", () => {
    const path = join(folder, "deep.json");
    writeFileSync(path, "[".repeat(200_000) + "]".repeat(200_000));
    expect(() => readJsonTolerant(path)).not.toThrow();
  });
});

describe("readTextTolerant", () => {
  test("returns the text, and null for a missing file or a folder", () => {
    const path = join(folder, "code.txt");
    writeFileSync(path, "EVA-1234");
    expect(readTextTolerant(path)).toBe("EVA-1234");
    expect(readTextTolerant(join(folder, "missing.txt"))).toBeNull();
    expect(readTextTolerant(folder)).toBeNull();
  });
});
