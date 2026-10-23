/**
 * The search of the file explorer: it finds vault files and folders by a part of the name, and on
 * request by a part of the text inside a file. It never follows a link, so it stays in the vault
 * (lesson 72), and it never looks in git data or in a secrets file.
 */
import { closeSync, constants, fstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { maxShownBytes, noWait, projectTitleIn, textOf } from "./file-browser.ts";
import { looksLikeSecretsFile } from "./vault-files.ts";

export interface SearchMatch {
  /** The forward-slash path from the vault root. */
  readonly path: string;
  readonly name: string;
  readonly kind: "folder" | "file";
  /** The project title, for a project folder in `Projects/` only. */
  readonly title?: string;
  /** The first line that holds the query, for a match inside the text only. */
  readonly line?: { readonly number: number; readonly text: string };
}

export interface SearchResult {
  readonly matches: readonly SearchMatch[];
  /** False when the search stopped at a limit before it saw the whole vault. */
  readonly complete: boolean;
}

/** A phone list of more matches is no help: the person types more words instead. */
export const maxSearchMatches = 100;
/** A clone can hold a very large dependency folder, and the walk blocks the core while it runs. */
const maxVisitedEntries = 20_000;
const maxReadBytes = 50_000_000;
/** The characters that a shown line keeps at each side of the match. */
const lineContext = 60;
const hiddenName = ".git";

/**
 * Finds the vault entries whose name, or project title, holds `query`, in any case. With
 * `contents`, a text file that holds `query` matches too. Folders near the root come first.
 */
export function searchVault(
  vaultPath: string,
  query: string,
  options: { readonly contents: boolean },
  redact: (text: string) => string,
): SearchResult {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { matches: [], complete: true };
  const root = realpathSync(vaultPath);
  const matches: SearchMatch[] = [];
  const budget = { entries: maxVisitedEntries, bytes: maxReadBytes };
  const queue: string[] = [""];
  for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
    for (const entry of sortedEntries(join(root, folder))) {
      budget.entries -= 1;
      if (budget.entries < 0) return { matches, complete: false };
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      const match = entry.kind === "folder" ? folderMatch(root, path, entry.name, needle) : null;
      const found =
        match ??
        (entry.name.toLowerCase().includes(needle)
          ? { path, name: entry.name, kind: entry.kind }
          : entry.kind === "file" && options.contents
            ? textMatch(join(root, path), path, entry.name, needle, budget, redact)
            : null);
      if (found !== null) matches.push(found);
      if (matches.length >= maxSearchMatches) return { matches, complete: false };
      if (entry.kind === "folder") queue.push(path);
    }
  }
  return { matches, complete: true };
}

/** Folders first, then files, each by name, as the folder list shows them. Links and special files are left out. */
function sortedEntries(folder: string): { readonly name: string; readonly kind: "folder" | "file" }[] {
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    // A folder that Eva may not read, or one that went away meanwhile.
    return [];
  }
  return entries
    .filter((entry) => entry.name.toLowerCase() !== hiddenName && (entry.isDirectory() || entry.isFile()))
    .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? ("folder" as const) : ("file" as const) }))
    .sort((first, second) =>
      first.kind === second.kind ? first.name.localeCompare(second.name) : first.kind === "folder" ? -1 : 1,
    );
}

function folderMatch(root: string, path: string, name: string, needle: string): SearchMatch | null {
  const title = projectTitleIn(root, join(root, path));
  const found = name.toLowerCase().includes(needle) || (title?.toLowerCase().includes(needle) ?? false);
  if (!found) return null;
  return title === null ? { path, name, kind: "folder" } : { path, name, kind: "folder", title };
}

/**
 * The first line of the file that holds the needle after the redactor ran, so a search never
 * tells which file holds a secret. The read goes through the open file, so a pipe never blocks.
 */
function textMatch(
  file: string,
  path: string,
  name: string,
  needle: string,
  budget: { bytes: number },
  redact: (text: string) => string,
): SearchMatch | null {
  if (looksLikeSecretsFile(name)) return null;
  let text: string | null;
  try {
    const handle = openSync(file, constants.O_RDONLY | noWait);
    try {
      const stats = fstatSync(handle);
      if (!stats.isFile() || stats.size > maxShownBytes || stats.size > budget.bytes) return null;
      budget.bytes -= stats.size;
      const bytes = Buffer.alloc(stats.size);
      text = textOf(bytes.subarray(0, readSync(handle, bytes, 0, stats.size, 0)));
    } finally {
      closeSync(handle);
    }
  } catch {
    return null;
  }
  if (!text?.toLowerCase().includes(needle)) return null;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const shown = redact(line);
    const at = shown.toLowerCase().indexOf(needle);
    if (at >= 0)
      return { path, name, kind: "file", line: { number: index + 1, text: cutAround(shown, at, needle.length) } };
  }
  return null;
}

/** The line, trimmed, with at most `lineContext` characters at each side of the match. */
function cutAround(line: string, at: number, length: number): string {
  const start = Math.max(0, at - lineContext);
  const end = Math.min(line.length, at + length + lineContext);
  const cut = line.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${cut}${end < line.length ? "…" : ""}`;
}
