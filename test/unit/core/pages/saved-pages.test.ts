import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { maxPageBytes, resolveShownPage } from "../../../../src/core/pages/chat-pages.ts";
import { removeSavedPage, savePage, writeProblem } from "../../../../src/core/pages/saved-pages.ts";
import { EvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let vault: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-saved-pages-"));
  vault = join(folder, "vault");
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

const page = "<!doctype html><title>Chart</title><p>Hi</p>";

function codeOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof EvaError ? error.code : "other";
  }
}

describe("savePage", () => {
  test("moves a scratch page to .eva/pages, and the old marker shows the saved file", () => {
    write(".eva/scratch/chart.html", page);
    expect(savePage(vault, ".eva/scratch/chart.html")).toBe(".eva/pages/chart.html");
    expect(readFileSync(join(vault, ".eva", "pages", "chart.html"), "utf8")).toBe(page);
    expect(existsSync(join(vault, ".eva", "scratch", "chart.html"))).toBe(false);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html")).toMatchObject({
      state: "ready",
      relativePath: ".eva/pages/chart.html",
      kept: "saved",
    });
  });

  test("does nothing more for a page that is already saved or kept in the notes", () => {
    write(".eva/pages/chart.html", page);
    write("Notes/plan.html", page);
    expect(savePage(vault, ".eva/scratch/chart.html")).toBe(".eva/pages/chart.html");
    expect(savePage(vault, ".eva/pages/chart.html")).toBe(".eva/pages/chart.html");
    expect(savePage(vault, "Notes/plan.html")).toBe("Notes/plan.html");
    expect(existsSync(join(vault, ".eva", "pages", "plan.html"))).toBe(false);
  });

  test("refuses a page that is gone, and one that holds a secret, which the sync would leave out", () => {
    expect(codeOf(() => savePage(vault, ".eva/scratch/old.html"))).toBe("file_not_found");
    write(".eva/scratch/keys.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    let reason = "";
    try {
      savePage(vault, ".eva/scratch/keys.html");
    } catch (error) {
      reason = error instanceof Error ? error.message : "";
    }
    expect(reason).toContain("holds a secret");
    expect(existsSync(join(vault, ".eva", "pages", "keys.html"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("refuses a pages folder that is a link to another folder", () => {
    write(".eva/scratch/chart.html", page);
    mkdirSync(join(vault, "Notes"), { recursive: true });
    symlinkSync(join(vault, "Notes"), join(vault, ".eva", "pages"));
    expect(codeOf(() => savePage(vault, ".eva/scratch/chart.html"))).toBe("file_not_writable");
    expect(existsSync(join(vault, "Notes", "chart.html"))).toBe(false);
    expect(existsSync(join(vault, ".eva", "scratch", "chart.html"))).toBe(true);
  });
});

/** Every entry under the test folder, with its kind and the bytes of a file, so a test sees that a refusal changed nothing. */
function snapshot(): string[] {
  const entries: string[] = [];
  const walk = (path: string): void => {
    const stats = lstatSync(path);
    const shown = relative(folder, path);
    if (stats.isSymbolicLink()) entries.push(`${shown} -> ${readlinkSync(path)}`);
    else if (stats.isDirectory()) {
      entries.push(`${shown}/`);
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else entries.push(`${shown} = ${readFileSync(path, "utf8")}`);
  };
  walk(folder);
  return entries;
}

/** The code of the refusal, after a check that the refusal changed nothing on disk. */
function refusalOf(action: () => unknown): string | null {
  const before = snapshot();
  const code = codeOf(action);
  expect(snapshot()).toEqual(before);
  return code;
}

describe("savePage and names", () => {
  test("names the saved file by the real path of the page, also through `..` parts, and the marker finds it", () => {
    write(".eva/scratch/sub/x.html", page);
    write(".eva/scratch/chart.html", page);
    write("Notes/plan.md", "# Plan");
    expect(savePage(vault, ".eva/scratch/sub/../chart.html")).toBe(".eva/pages/chart.html");
    expect(resolveShownPage(vault, ".eva/scratch/sub/../chart.html")).toMatchObject({ kept: "saved" });
    expect(savePage(vault, "Notes/../.eva/scratch//sub/./x.html")).toBe(".eva/pages/sub/x.html");
    expect(resolveShownPage(vault, ".eva/scratch/sub/x.html")).toMatchObject({ kept: "saved" });
    expect(removeSavedPage(vault, "Notes/../.eva/scratch/sub/x.html")).toBe(".eva/pages/sub/x.html");
  });

  test.skipIf(process.platform === "win32")(
    "refuses a scratch entry that is a link, so it never deletes another page, and changes nothing",
    () => {
      write(".eva/scratch/b.html", page);
      write("Notes/plan.md", "# Plan");
      symlinkSync(join(vault, ".eva", "scratch", "b.html"), join(vault, ".eva", "scratch", "a.html"));
      symlinkSync(join(vault, ".eva", "scratch", "b.html"), join(vault, "Notes", "into.html"));
      expect(refusalOf(() => savePage(vault, ".eva/scratch/a.html"))).toBe("file_not_writable");
      expect(refusalOf(() => savePage(vault, "Notes/into.html"))).toBe("file_not_writable");
    },
  );

  test.skipIf(process.platform === "win32")("saves through a folder link into scratch by the real name", () => {
    write(".eva/scratch/sub/x.html", page);
    mkdirSync(join(vault, "Notes"), { recursive: true });
    symlinkSync(join(vault, ".eva", "scratch", "sub"), join(vault, "Notes", "door"));
    expect(savePage(vault, "Notes/door/x.html")).toBe(".eva/pages/sub/x.html");
    expect(resolveShownPage(vault, "Notes/door/x.html")).toMatchObject({ relativePath: ".eva/pages/sub/x.html" });
  });

  test.skipIf(process.platform === "win32")(
    "checks each folder before it makes one: a link in .eva/pages, or .eva/pages as a link, makes nothing outside",
    () => {
      write(".eva/scratch/a/sub/x.html", page);
      mkdirSync(join(folder, "outside"), { recursive: true });
      mkdirSync(join(vault, ".eva", "pages"), { recursive: true });
      symlinkSync(join(folder, "outside"), join(vault, ".eva", "pages", "a"));
      expect(refusalOf(() => savePage(vault, ".eva/scratch/a/sub/x.html"))).toBe("file_not_writable");
      expect(existsSync(join(folder, "outside", "sub"))).toBe(false);
      rmSync(join(vault, ".eva", "pages"), { recursive: true });
      symlinkSync(join(folder, "outside"), join(vault, ".eva", "pages"));
      expect(refusalOf(() => savePage(vault, ".eva/scratch/a/sub/x.html"))).toBe("file_not_writable");
      expect(refusalOf(() => removeSavedPage(vault, ".eva/scratch/a/sub/x.html"))).toBe("file_not_writable");
    },
  );

  test.skipIf(process.platform !== "win32")(
    "takes the case on disk on Windows, where a folder of another case is the same folder",
    () => {
      write(".eva/scratch/report/x.html", page);
      mkdirSync(join(vault, ".eva", "pages", "Report"), { recursive: true });
      expect(savePage(vault, ".EVA/Scratch/Report/X.html")).toBe(".eva/pages/report/x.html");
      expect(resolveShownPage(vault, ".eva/scratch/REPORT/x.html")).toMatchObject({ kept: "saved" });
      expect(removeSavedPage(vault, ".eva/scratch/Report/x.html")).toBe(".eva/pages/report/x.html");
    },
  );

  test("keeps a page of a scratch subfolder in the same subfolder of .eva/pages", () => {
    write(".eva/scratch/a/chart.html", page);
    write(".eva/scratch/b/chart.html", "<p>b</p>");
    expect(savePage(vault, ".eva/scratch/a/chart.html")).toBe(".eva/pages/a/chart.html");
    expect(resolveShownPage(vault, ".eva/scratch/b/chart.html")).toMatchObject({ kept: "temporary" });
    expect(savePage(vault, ".eva/scratch/b/chart.html")).toBe(".eva/pages/b/chart.html");
    expect(readFileSync(join(vault, ".eva", "pages", "a", "chart.html"), "utf8")).toBe(page);
    expect(readFileSync(join(vault, ".eva", "pages", "b", "chart.html"), "utf8")).toBe("<p>b</p>");
  });

  test("replaces an older saved page of the same name: the new page is the newest version", () => {
    write(".eva/pages/sales.html", "<p>old</p>");
    write(".eva/scratch/sales.html", "<p>new</p>");
    expect(resolveShownPage(vault, ".eva/scratch/sales.html")).toMatchObject({ kept: "temporary" });
    expect(savePage(vault, ".eva/scratch/sales.html")).toBe(".eva/pages/sales.html");
    expect(readFileSync(join(vault, ".eva", "pages", "sales.html"), "utf8")).toBe("<p>new</p>");
    expect(existsSync(join(vault, ".eva", "scratch", "sales.html"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("never writes over a link or a folder in .eva/pages", () => {
    write(".eva/scratch/chart.html", page);
    write(".eva/scratch/plan.html", page);
    mkdirSync(join(vault, ".eva", "pages", "plan.html"), { recursive: true });
    // A link that leads out of Eva's folder: Save must not write through it.
    symlinkSync(join(vault, "outside.html"), join(vault, ".eva", "pages", "chart.html"));
    expect(codeOf(() => savePage(vault, ".eva/scratch/chart.html"))).toBe("file_not_writable");
    expect(codeOf(() => savePage(vault, ".eva/scratch/plan.html"))).toBe("file_not_writable");
    expect(existsSync(join(vault, ".eva", "scratch", "chart.html"))).toBe(true);
    expect(existsSync(join(vault, "outside.html"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("refuses a subfolder of .eva/pages that is a link", () => {
    write(".eva/scratch/a/chart.html", page);
    mkdirSync(join(vault, "Notes"), { recursive: true });
    mkdirSync(join(vault, ".eva", "pages"), { recursive: true });
    symlinkSync(join(vault, "Notes"), join(vault, ".eva", "pages", "a"));
    expect(codeOf(() => savePage(vault, ".eva/scratch/a/chart.html"))).toBe("file_not_writable");
    expect(existsSync(join(vault, "Notes", "chart.html"))).toBe(false);
  });

  test("refuses a file in the place of the pages folder", () => {
    write(".eva/scratch/chart.html", page);
    write(".eva/pages", "not a folder");
    expect(codeOf(() => savePage(vault, ".eva/scratch/chart.html"))).toBe("file_not_writable");
    expect(existsSync(join(vault, ".eva", "scratch", "chart.html"))).toBe(true);
  });
});

describe("writeProblem", () => {
  test("names the cause of a failed write, so a full disk is not a missing permission", () => {
    const failure = (code: string): Error => Object.assign(new Error(code), { code });
    expect(writeProblem(failure("EACCES"))).toBe("Eva has no permission to write there");
    expect(writeProblem(failure("ENOSPC"))).toBe("the disk is full");
    expect(writeProblem(failure("EROFS"))).toBe("the disk takes no writes");
    expect(writeProblem(failure("ENOTSUP"))).toBe("the file system answered ENOTSUP");
    expect(writeProblem("odd")).toBe("the file system answered unknown");
  });
});

describe("removeSavedPage", () => {
  test("deletes a saved page, and the old marker then finds no page", () => {
    write(".eva/pages/chart.html", page);
    expect(removeSavedPage(vault, ".eva/scratch/chart.html")).toBe(".eva/pages/chart.html");
    expect(existsSync(join(vault, ".eva", "pages", "chart.html"))).toBe(false);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html").state).toBe("gone");
  });

  test("removes a saved page that Eva does not show any more, such as one with a secret or above 2 MB", () => {
    write(".eva/pages/keys.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    write(".eva/pages/big.html", "x".repeat(maxPageBytes + 1));
    expect(removeSavedPage(vault, ".eva/scratch/keys.html")).toBe(".eva/pages/keys.html");
    expect(removeSavedPage(vault, ".eva/pages/big.html")).toBe(".eva/pages/big.html");
    expect(existsSync(join(vault, ".eva", "pages", "keys.html"))).toBe(false);
    expect(existsSync(join(vault, ".eva", "pages", "big.html"))).toBe(false);
  });

  test("removes only a saved page, never a scratch page or a note", () => {
    write(".eva/scratch/chart.html", page);
    write("Notes/plan.html", page);
    write(".eva/pages/folder/inside.html", page);
    expect(codeOf(() => removeSavedPage(vault, ".eva/scratch/chart.html"))).toBe("file_not_found");
    expect(existsSync(join(vault, ".eva", "scratch", "chart.html"))).toBe(true);
    expect(codeOf(() => removeSavedPage(vault, "Notes/plan.html"))).toBe("file_not_writable");
    expect(existsSync(join(vault, "Notes", "plan.html"))).toBe(true);
    expect(codeOf(() => removeSavedPage(vault, ".eva/pages/folder"))).toBe("file_not_writable");
    expect(codeOf(() => removeSavedPage(vault, ".eva/pages/none.html"))).toBe("file_not_found");
  });

  test.skipIf(process.platform === "win32")("removes a link in .eva/pages, never the file that it names", () => {
    write("Notes/plan.html", page);
    mkdirSync(join(vault, ".eva", "pages"), { recursive: true });
    symlinkSync(join(vault, "Notes", "plan.html"), join(vault, ".eva", "pages", "plan.html"));
    expect(removeSavedPage(vault, ".eva/pages/plan.html")).toBe(".eva/pages/plan.html");
    expect(existsSync(join(vault, "Notes", "plan.html"))).toBe(true);
  });
});
