import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveShownPage } from "../../../../src/core/pages/chat-pages.ts";
import { removeSavedPage, savePage } from "../../../../src/core/pages/saved-pages.ts";
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

describe("removeSavedPage", () => {
  test("deletes a saved page, and the old marker then finds no page", () => {
    write(".eva/pages/chart.html", page);
    expect(removeSavedPage(vault, ".eva/scratch/chart.html")).toBe(".eva/pages/chart.html");
    expect(existsSync(join(vault, ".eva", "pages", "chart.html"))).toBe(false);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html").state).toBe("gone");
  });

  test("removes only a saved page, never a scratch page or a note", () => {
    write(".eva/scratch/chart.html", page);
    write("Notes/plan.html", page);
    expect(codeOf(() => removeSavedPage(vault, ".eva/scratch/chart.html"))).toBe("file_not_writable");
    expect(codeOf(() => removeSavedPage(vault, "Notes/plan.html"))).toBe("file_not_writable");
    expect(existsSync(join(vault, "Notes", "plan.html"))).toBe(true);
    expect(codeOf(() => removeSavedPage(vault, ".eva/pages/none.html"))).toBe("file_not_found");
  });
});
