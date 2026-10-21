import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  favoritesPath,
  moveFavorites,
  readFavorites,
  setFavorite,
} from "../../../../src/core/files/vault-favorites.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let vault: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-favorites-"));
  vault = join(folder, "vault");
  write("Notes/list.md", "# Shopping\n");
  write("Projects/2025-03-02-1015-example-app/AGENTS.md", "# Example app\n");
  write(".git/config", "[core]\n");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const path = join(vault, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("readFavorites", () => {
  test("a vault without the file has no favorites", () => {
    expect(readFavorites(vault)).toEqual([]);
  });

  test("a broken file has no favorites, and Eva does not crash", () => {
    write(".eva/favorites.json", "{ not json");
    expect(readFavorites(vault)).toEqual([]);
  });

  test("each favorite says if it is a folder or a file, and a gone one is missing", () => {
    write(
      ".eva/favorites.json",
      JSON.stringify({ version: 1, paths: ["Notes/list.md", "Projects", "Old/gone.md", 42, "Notes/list.md"] }),
    );
    expect(readFavorites(vault)).toEqual([
      { path: "Notes/list.md", name: "list.md", kind: "file" },
      { path: "Projects", name: "Projects", kind: "folder" },
      { path: "Old/gone.md", name: "gone.md", kind: "missing" },
    ]);
  });

  test("a path out of the vault or into git data counts as missing, so it never opens", () => {
    write(".eva/favorites.json", JSON.stringify({ version: 1, paths: ["../outside", ".git/config"] }));
    expect(readFavorites(vault).map((favorite) => favorite.kind)).toEqual(["missing", "missing"]);
  });
});

describe("moveFavorites", () => {
  test("a renamed favorite, and each favorite inside a renamed folder, keeps its place under the new path", () => {
    write(
      ".eva/favorites.json",
      JSON.stringify({ version: 1, paths: ["Notes/list.md", "Projects", "Notes", "Notes-old/x.md"] }),
    );
    moveFavorites(vault, "Notes", "Ideas");
    expect(readFavorites(vault).map((favorite) => favorite.path)).toEqual([
      "Ideas/list.md",
      "Projects",
      "Ideas",
      "Notes-old/x.md",
    ]);
  });

  test("a rename of a path that is no favorite leaves the file alone", () => {
    moveFavorites(vault, "Notes/list.md", "Notes/shopping.md");
    expect(existsSync(favoritesPath(vault))).toBe(false);
  });
});

describe("setFavorite", () => {
  test("adds a favorite at the end and keeps it in the vault's .eva folder", () => {
    setFavorite(vault, "Projects", true);
    const favorites = setFavorite(vault, "Notes\\list.md/", true);
    expect(favorites.map((favorite) => favorite.path)).toEqual(["Projects", "Notes/list.md"]);
    expect(JSON.parse(readFileSync(favoritesPath(vault), "utf-8"))).toEqual({
      version: 1,
      paths: ["Projects", "Notes/list.md"],
    });
  });

  test("adds a favorite once only", () => {
    setFavorite(vault, "Projects", true);
    expect(setFavorite(vault, "Projects", true).map((favorite) => favorite.path)).toEqual(["Projects"]);
  });

  test("removes a favorite, also one that is gone from the vault", () => {
    write(".eva/favorites.json", JSON.stringify({ version: 1, paths: ["Old/gone.md", "Projects"] }));
    expect(setFavorite(vault, "Old/gone.md", false).map((favorite) => favorite.path)).toEqual(["Projects"]);
  });

  test("refuses a path that is missing, out of the vault, or the vault root", () => {
    for (const path of ["Nothing/here.md", "../outside", ".git/config", ""]) {
      let caught: unknown = null;
      try {
        setFavorite(vault, path, true);
      } catch (error) {
        caught = error;
      }
      expect(isEvaError(caught, "file_not_found")).toBe(true);
    }
    expect(readFavorites(vault)).toEqual([]);
  });
});
