/**
 * The favorite files and folders of the file explorer (issue 349), in the vault's
 * `.eva/favorites.json`. They are the person's data, so every machine with the vault shows the
 * same ones. A person or an agent can edit the file, so a read never throws.
 */
import { statSync } from "node:fs";
import { basename, join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { normalizedPath, resolveInVault } from "./file-browser.ts";

export interface Favorite {
  /** A forward-slash path from the vault root. */
  readonly path: string;
  readonly name: string;
  /** "missing" is a favorite that was moved or deleted. It stays, so the person can remove it. */
  readonly kind: "folder" | "file" | "missing";
}

export const favoritesFormatVersion = 1;

/** The JSON of `.eva/favorites.json`. */
export interface StoredFavorites {
  readonly version: typeof favoritesFormatVersion;
  readonly paths: readonly string[];
}

export function favoritesPath(vaultPath: string): string {
  return join(vaultPath, ".eva", "favorites.json");
}

/** The favorites in the person's order, each with what it is now. */
export function readFavorites(vaultPath: string): Favorite[] {
  return storedPaths(vaultPath).map((path) => describe(vaultPath, path));
}

/**
 * Adds `requested` at the end of the favorites, or removes it. Throws `file_not_found` when an
 * added path is missing, leaves the vault, or is the vault root, which the page shows already.
 */
export function setFavorite(vaultPath: string, requested: string, favorite: boolean): Favorite[] {
  const stored = storedPaths(vaultPath);
  let path = normalizedPath(requested);
  if (favorite) {
    path = resolveInVault(vaultPath, requested).path;
    if (path === "") throw new EvaError("file_not_found", "The vault is always at the top of the Files page.");
  }
  const next = favorite ? (stored.includes(path) ? stored : [...stored, path]) : stored.filter((kept) => kept !== path);
  if (next.length !== stored.length) {
    assertVaultWritable(vaultPath);
    const file: StoredFavorites = { version: favoritesFormatVersion, paths: next };
    writeFileAtomic(favoritesPath(vaultPath), `${JSON.stringify(file, null, 2)}\n`);
  }
  return next.map((kept) => describe(vaultPath, kept));
}

/** The stored paths, tidied, without doubles. A bad entry is skipped. */
function storedPaths(vaultPath: string): string[] {
  const read = readJsonTolerant(favoritesPath(vaultPath));
  if (!read.ok || typeof read.value !== "object" || read.value === null) return [];
  const paths = (read.value as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];
  const tidy = paths.filter((path): path is string => typeof path === "string").map(normalizedPath);
  return [...new Set(tidy.filter((path) => path !== ""))];
}

function describe(vaultPath: string, path: string): Favorite {
  const name = basename(path);
  try {
    const { resolved } = resolveInVault(vaultPath, path);
    const stats = statSync(resolved);
    if (stats.isDirectory()) return { path, name, kind: "folder" };
    if (stats.isFile()) return { path, name, kind: "file" };
  } catch {
    // Moved, deleted, or out of the vault: the page shows it as missing.
  }
  return { path, name, kind: "missing" };
}
