import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  childFolders,
  entriesOf,
  hasControlCharacter,
  isRealFolder,
  readBounded,
} from "../../../../src/core/files/bounded-reading.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-bounded-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A link needs a right that a Windows account can lack: a test that needs one skips then. */
function link(target: string, path: string, type: "dir" | "file"): void {
  symlinkSync(target, path, type === "dir" ? "junction" : "file");
}

const canLink = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), "eva-bounded-probe-"));
  try {
    writeFileSync(join(probe, "target.md"), "x");
    link(join(probe, "target.md"), join(probe, "link.md"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

describe("readBounded", () => {
  test("reads a whole file under the limit", () => {
    const path = join(root, "note.md");
    writeFileSync(path, "hello");
    expect(readBounded(path, 100)).toEqual({ text: "hello", bytes: 5, cut: false });
  });

  test("a file exactly at the limit is not cut", () => {
    const path = join(root, "note.md");
    writeFileSync(path, "12345");
    expect(readBounded(path, 5)).toEqual({ text: "12345", bytes: 5, cut: false });
  });

  test("a larger file gives its head and says it is cut", () => {
    const path = join(root, "note.md");
    writeFileSync(path, "abcdefghij");
    expect(readBounded(path, 4)).toEqual({ text: "abcd", bytes: 4, cut: true });
  });

  test("a limit in the middle of a multibyte character does not fail", () => {
    const path = join(root, "note.md");
    // "é" takes two bytes: a limit of 2 cuts it in two.
    writeFileSync(path, "aé");
    const result = readBounded(path, 2);
    expect(result).not.toBeNull();
    expect(result?.bytes).toBe(2);
    expect(result?.cut).toBe(true);
    expect(result?.text.startsWith("a")).toBe(true);
    expect(result?.text).toBe("a�");
  });

  test("a missing file gives null", () => {
    expect(readBounded(join(root, "none.md"), 100)).toBeNull();
  });

  test("a folder gives null", () => {
    expect(readBounded(root, 100)).toBeNull();
  });

  test("a file with a zero byte gives null", () => {
    const path = join(root, "binary.bin");
    writeFileSync(path, Buffer.from([0x61, 0x00, 0x62]));
    expect(readBounded(path, 100)).toBeNull();
  });
});

describe("isRealFolder", () => {
  test("is true for a real folder, also a nested one", () => {
    mkdirSync(join(root, "Life", "Pets"), { recursive: true });
    expect(isRealFolder(root, "Life")).toBe(true);
    expect(isRealFolder(root, "Life/Pets")).toBe(true);
  });

  test("is false for a missing folder and for a file", () => {
    writeFileSync(join(root, "file.md"), "x");
    expect(isRealFolder(root, "Missing")).toBe(false);
    expect(isRealFolder(root, "file.md")).toBe(false);
  });

  test.skipIf(!canLink)("is false when a part of the path is a link", () => {
    mkdirSync(join(root, "outside", "inner"), { recursive: true });
    mkdirSync(join(root, "vault"));
    link(join(root, "outside"), join(root, "vault", "Life"), "dir");
    expect(isRealFolder(join(root, "vault"), "Life")).toBe(false);
    expect(isRealFolder(join(root, "vault"), "Life/inner")).toBe(false);
  });
});

describe("entriesOf and childFolders", () => {
  test("list folders and files by name, and leave out a name with a control character", () => {
    mkdirSync(join(root, "b-folder"));
    mkdirSync(join(root, ".hidden"));
    writeFileSync(join(root, "a-file.md"), "x");
    writeFileSync(join(root, "bad name.md"), "x");
    expect(entriesOf(root)).toEqual([
      { name: ".hidden", folder: true },
      { name: "a-file.md", folder: false },
      { name: "b-folder", folder: true },
    ]);
    expect(childFolders(root)).toEqual(["b-folder"]);
  });

  test.skipIf(!canLink)("drop a link to a folder and a link to a file", () => {
    mkdirSync(join(root, "real"));
    mkdirSync(join(root, "target"));
    writeFileSync(join(root, "target", "file.md"), "x");
    writeFileSync(join(root, "plain.md"), "x");
    link(join(root, "target"), join(root, "linked-folder"), "dir");
    link(join(root, "plain.md"), join(root, "linked-file.md"), "file");
    const names = entriesOf(root).map((entry) => entry.name);
    expect(names).not.toContain("linked-folder");
    expect(names).not.toContain("linked-file.md");
    expect(names).toContain("real");
    expect(names).toContain("plain.md");
    expect(childFolders(root)).toEqual(["real", "target"]);
  });

  test("give nothing for a missing folder", () => {
    expect(entriesOf(join(root, "none"))).toEqual([]);
    expect(childFolders(join(root, "none"))).toEqual([]);
  });
});

describe("hasControlCharacter", () => {
  test("finds a line break, a tab, a delete and a Unicode line separator", () => {
    for (const name of ["a\nb", "a\rb", "a\tb", "a\u007fb", "a\u0085b", "a b", "a b"]) {
      expect(hasControlCharacter(name), JSON.stringify(name)).toBe(true);
    }
  });

  test("accepts an ordinary name, with a space or an accent", () => {
    expect(hasControlCharacter("Café notes.md")).toBe(false);
  });
});
