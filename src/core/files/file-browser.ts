/**
 * The file explorer of the web page (issue 253): it lists a vault folder or shows a text file.
 * It only reads. Each path is resolved before the check, so neither `..` nor a symbolic link
 * can point out of the vault (lesson 72).
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { looksLikeSecretsFile } from "./vault-files.ts";

export interface FileEntry {
  readonly name: string;
  /** "other" is a link that leads out of the vault or nowhere, or a special file. It does not open. */
  readonly kind: "folder" | "file" | "other";
  /** Bytes, for a file only. */
  readonly size: number | null;
}

export type BrowsedPath =
  | { readonly kind: "folder"; readonly path: string; readonly entries: readonly FileEntry[] }
  | { readonly kind: "file"; readonly path: string; readonly size: number; readonly text: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly size: number; readonly reason: string };

/** A phone shows 1 MB of text slowly already, and a project file has the same limit. */
export const maxShownBytes = 1_000_000;
/** Git looks at the same amount to tell text from binary. */
const sniffBytes = 8_000;
/** Git data is not for people to read, and can hold a remote's token. */
const hiddenName = ".git";

/**
 * Lists the folder or shows the file at `requested`, a forward-slash path from the vault root.
 * The empty path is the root. Throws `file_not_found` for a path that is missing or leaves the vault.
 */
export function browseVault(vaultPath: string, requested: string, redact: (text: string) => string): BrowsedPath {
  const path = normalizedPath(requested);
  const notFound = new EvaError("file_not_found", `${path === "" ? "The vault" : path} was not found.`);
  if (path.split("/").includes(hiddenName)) throw notFound;
  let root: string;
  let resolved: string;
  try {
    root = realpathSync(vaultPath);
    resolved = realpathSync(join(root, path));
  } catch {
    throw notFound;
  }
  if (!isInside(root, resolved)) throw notFound;
  const stats = statSync(resolved);
  if (stats.isDirectory()) return { kind: "folder", path, entries: listFolder(root, resolved) };
  if (!stats.isFile()) throw notFound;
  const unreadable = (reason: string): BrowsedPath => ({ kind: "unreadable", path, size: stats.size, reason });
  if (looksLikeSecretsFile(path.split("/").at(-1) ?? ""))
    return unreadable("This looks like a secrets file, so Eva does not show it.");
  if (stats.size > maxShownBytes) return unreadable("This file is larger than 1 MB, so Eva does not show it.");
  const text = textOf(readFileSync(resolved));
  if (text === null) return unreadable("This file is not plain text, so Eva cannot show it.");
  return { kind: "file", path, size: stats.size, text: redact(text) };
}

/** The forward-slash path without empty or `.` parts. A `..` part stays, so the resolve check sees it. */
function normalizedPath(requested: string): string {
  return requested
    .split(/[/\\]/)
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

function isInside(root: string, resolved: string): boolean {
  const relativePath = relative(root, resolved);
  return (
    relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

/** Folders first, then files, each by name. A link counts as what it points to, when that is inside the vault. */
function listFolder(root: string, folder: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === hiddenName) continue;
    entries.push(describeEntry(root, join(folder, entry.name), entry.name));
  }
  const order = { folder: 0, file: 1, other: 2 };
  return entries.sort(
    (first, second) => order[first.kind] - order[second.kind] || first.name.localeCompare(second.name),
  );
}

function describeEntry(root: string, path: string, name: string): FileEntry {
  try {
    const resolved = realpathSync(path);
    if (!isInside(root, resolved)) return { name, kind: "other", size: null };
    const stats = statSync(resolved);
    if (stats.isDirectory()) return { name, kind: "folder", size: null };
    if (stats.isFile()) return { name, kind: "file", size: stats.size };
  } catch {
    // A broken link, or a file that went away meanwhile.
  }
  return { name, kind: "other", size: null };
}

/** The UTF-8 text, or null for a binary file. A NUL byte near the start marks one, as git decides. */
function textOf(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, sniffBytes).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
