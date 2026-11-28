import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pageNameOf } from "../../../../src/core/pages/page-names.ts";

let folder: string;
let vault: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-page-names-"));
  vault = join(folder, "vault");
  for (const path of [
    ".eva/scratch/chart.html",
    ".eva/scratch/b.html",
    ".eva/scratch/sub/x.html",
    ".eva/pages/kept.html",
    "Scratch/pages/old.html",
    "Notes/plan.html",
  ]) {
    mkdirSync(dirname(join(vault, path)), { recursive: true });
    writeFileSync(join(vault, path), "<p>page</p>");
  }
  mkdirSync(join(folder, "outside"), { recursive: true });
  writeFileSync(join(folder, "outside", "far.html"), "<p>far</p>");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

type Expected = { readonly kind: "scratch" | "saved"; readonly name: string; readonly scratch: string } | null;

const posix = process.platform !== "win32";

describe("pageNameOf (#1130)", () => {
  test.each<[string, string, Expected]>([
    [
      "a scratch page",
      ".eva/scratch/chart.html",
      { kind: "scratch", name: "chart.html", scratch: ".eva/scratch/chart.html" },
    ],
    [
      "a scratch page that is gone",
      ".eva/scratch/gone.html",
      { kind: "scratch", name: "gone.html", scratch: ".eva/scratch/gone.html" },
    ],
    [
      "a page in a scratch subfolder",
      ".eva/scratch/sub/x.html",
      { kind: "scratch", name: "sub/x.html", scratch: ".eva/scratch/sub/x.html" },
    ],
    [
      "a doubled slash and a dot part",
      ".eva//scratch/./sub/x.html",
      { kind: "scratch", name: "sub/x.html", scratch: ".eva/scratch/sub/x.html" },
    ],
    // A back slash separates parts only on Windows: elsewhere it is a character of one name in the vault root.
    [
      "back slashes",
      ".eva\\scratch\\sub\\x.html",
      posix ? null : { kind: "scratch", name: "sub/x.html", scratch: ".eva/scratch/sub/x.html" },
    ],
    [
      "a `..` after a folder that exists",
      ".eva/scratch/sub/../chart.html",
      { kind: "scratch", name: "chart.html", scratch: ".eva/scratch/chart.html" },
    ],
    [
      "a `..` from a notes folder into scratch",
      "Notes/../.eva/scratch/chart.html",
      { kind: "scratch", name: "chart.html", scratch: ".eva/scratch/chart.html" },
    ],
    // `resolveSendableFile` opens `join(root, path)`, which drops `none/..`: the name follows the file that Eva shows.
    [
      "a `..` after a folder that does not exist",
      ".eva/scratch/none/../chart.html",
      { kind: "scratch", name: "chart.html", scratch: ".eva/scratch/chart.html" },
    ],
    ["a `..` at the end", ".eva/scratch/sub/..", null],
    ["a path that leaves the vault", "../outside/far.html", null],
    ["a path that leaves the vault from scratch", ".eva/scratch/../../../outside/far.html", null],
    ["an absolute path", "/etc/hosts.html", null],
    [
      "the old Scratch folder, with a pages subfolder",
      "Scratch/pages/old.html",
      { kind: "scratch", name: "pages/old.html", scratch: "Scratch/pages/old.html" },
    ],
    ["a saved page", ".eva/pages/kept.html", { kind: "saved", name: "kept.html", scratch: ".eva/scratch/kept.html" }],
    [
      "a saved page in a subfolder that does not exist",
      ".eva/pages/a/b.html",
      { kind: "saved", name: "a/b.html", scratch: ".eva/scratch/a/b.html" },
    ],
    ["a notes folder", "Notes/plan.html", null],
    ["the scratch folder itself", ".eva/scratch", null],
    ["the pages folder itself", ".eva/pages/", null],
  ])("%s", (_name, requested, expected) => {
    const name = pageNameOf(vault, requested);
    if (expected === null) expect(name).toBeNull();
    else expect(name).toEqual({ ...expected, saved: `.eva/pages/${expected.name}` });
  });

  test.skipIf(!posix)("names a page by the real path of its file, through links on both sides", () => {
    // A link at the file, from a notes folder into scratch, and inside scratch.
    symlinkSync(join(vault, ".eva", "scratch", "chart.html"), join(vault, "Notes", "into.html"));
    symlinkSync(join(vault, ".eva", "scratch", "b.html"), join(vault, ".eva", "scratch", "a.html"));
    // A link at a folder, from a notes folder into scratch, from scratch out to notes, and out of the vault.
    symlinkSync(join(vault, ".eva", "scratch", "sub"), join(vault, "Notes", "door"));
    symlinkSync(join(vault, "Notes"), join(vault, ".eva", "scratch", "notes"));
    symlinkSync(join(folder, "outside"), join(vault, ".eva", "scratch", "away"));
    mkdirSync(join(vault, ".eva", "pages"), { recursive: true });
    symlinkSync(join(vault, "Notes"), join(vault, ".eva", "pages", "linked"));
    expect(pageNameOf(vault, "Notes/into.html")).toMatchObject({ kind: "scratch", name: "chart.html" });
    expect(pageNameOf(vault, ".eva/scratch/a.html")).toMatchObject({ kind: "scratch", name: "b.html" });
    expect(pageNameOf(vault, "Notes/door/x.html")).toMatchObject({ kind: "scratch", name: "sub/x.html" });
    expect(pageNameOf(vault, ".eva/scratch/notes/plan.html")).toBeNull();
    expect(pageNameOf(vault, ".eva/scratch/away/far.html")).toBeNull();
    expect(pageNameOf(vault, ".eva/pages/linked/plan.html")).toBeNull();
  });

  test.skipIf(!posix)("takes no case or trailing dot of another folder on a file system that keeps them", () => {
    expect(pageNameOf(vault, ".EVA/SCRATCH/chart.html")).toBeNull();
    expect(pageNameOf(vault, ".eva/scratch./chart.html")).toBeNull();
  });

  test.skipIf(posix)("reads a different case and a trailing dot as Windows does, with the case on disk", () => {
    expect(pageNameOf(vault, ".EVA/SCRATCH/SUB/X.html")).toMatchObject({ kind: "scratch", name: "sub/x.html" });
    expect(pageNameOf(vault, ".eva/scratch./chart.html")).toMatchObject({ kind: "scratch", name: "chart.html" });
    expect(pageNameOf(vault, ".EVA/Scratch/Gone.html")).toMatchObject({ kind: "scratch", name: "Gone.html" });
  });
});
