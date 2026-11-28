import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deletePageEntry, plainPageFile } from "../../../../src/core/pages/page-entries.ts";

let folder: string;
let root: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-page-entries-"));
  root = join(realpathSync(folder), "vault");
  for (const path of [".eva/scratch/sub/x.html", ".eva/pages/sub/x.html", "Scratch/old.html", "Notes/n.html"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "<p>page</p>");
  }
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const posix = process.platform !== "win32";

describe("plainPageFile (#1130)", () => {
  test.each<[string, string, boolean]>([
    ["a scratch file", ".eva/scratch/sub/x.html", true],
    ["a saved file", ".eva/pages/sub/x.html", true],
    ["a file of the old Scratch folder", "Scratch/old.html", true],
    ["a file that does not exist", ".eva/scratch/sub/none.html", false],
    ["a folder", ".eva/scratch/sub", false],
    ["a folder that does not exist", ".eva/scratch/none/x.html", false],
  ])("%s", (_name, path, plain) => {
    expect(plainPageFile(root, path)).toBe(plain ? join(root, ...path.split("/")) : null);
  });

  test.skipIf(!posix)("finds no page through a link at any level, on either side", () => {
    symlinkSync(join(root, "Notes", "n.html"), join(root, ".eva", "scratch", "file-link.html"));
    symlinkSync(join(root, "Notes"), join(root, ".eva", "scratch", "folder-link"));
    symlinkSync(join(root, "Notes", "n.html"), join(root, ".eva", "pages", "file-link.html"));
    symlinkSync(join(root, "Notes"), join(root, ".eva", "pages", "folder-link"));
    for (const path of [
      ".eva/scratch/file-link.html",
      ".eva/scratch/folder-link/n.html",
      ".eva/pages/file-link.html",
      ".eva/pages/folder-link/n.html",
    ])
      expect(plainPageFile(root, path)).toBeNull();
    // The link itself counts for Remove, which removes it and never its target.
    expect(plainPageFile(root, ".eva/pages/file-link.html", "entry")).toBe(
      join(root, ".eva", "pages", "file-link.html"),
    );
    expect(plainPageFile(root, ".eva/pages/folder-link/n.html", "entry")).toBeNull();
    // A link at the level of a page folder itself.
    rmSync(join(root, ".eva", "pages"), { recursive: true });
    symlinkSync(join(root, "Notes"), join(root, ".eva", "pages"));
    expect(plainPageFile(root, ".eva/pages/n.html")).toBeNull();
  });
});

describe("deletePageEntry (#1130)", () => {
  test("deletes one plain page entry of a page folder", () => {
    deletePageEntry(root, ".eva/scratch/sub/x.html");
    deletePageEntry(root, ".eva/pages/sub/x.html");
    deletePageEntry(root, "Scratch/old.html");
    expect(existsSync(join(root, ".eva", "scratch", "sub", "x.html"))).toBe(false);
    expect(existsSync(join(root, ".eva", "pages", "sub", "x.html"))).toBe(false);
    expect(existsSync(join(root, "Scratch", "old.html"))).toBe(false);
  });

  test.each([
    "Notes/n.html",
    ".eva/scratch/../../Notes/n.html",
    ".eva/scratch/./sub/x.html",
    ".eva//scratch/sub/x.html",
    ".eva/pagesx/x.html",
    ".eva/scratch",
    ".eva/pages/",
    "Scratch",
    ".eva/scratch/sub",
  ])("never deletes %s", (path) => {
    expect(() => deletePageEntry(root, path)).toThrow();
    expect(existsSync(join(root, "Notes", "n.html"))).toBe(true);
    expect(existsSync(join(root, ".eva", "scratch", "sub", "x.html"))).toBe(true);
  });

  test.skipIf(!posix)("never deletes through a link, and removes a link in .eva/pages itself", () => {
    symlinkSync(join(root, "Notes"), join(root, ".eva", "scratch", "door"));
    expect(() => deletePageEntry(root, ".eva/scratch/door/n.html")).toThrow();
    symlinkSync(join(root, "Notes", "n.html"), join(root, ".eva", "pages", "link.html"));
    deletePageEntry(root, ".eva/pages/link.html");
    expect(existsSync(join(root, ".eva", "pages", "link.html"))).toBe(false);
    expect(existsSync(join(root, "Notes", "n.html"))).toBe(true);
  });
});
