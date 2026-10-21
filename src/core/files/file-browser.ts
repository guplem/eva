/**
 * The file explorer of the web page (issue 253): it lists a vault folder, shows a text file, and
 * saves the person's edit of one (issue 308). Each path is resolved before the check, so neither
 * `..` nor a symbolic link can point out of the vault (lesson 72).
 */
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { fileVersion, matchFileStyle } from "../projects/project-file.ts";
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
  | {
      readonly kind: "file";
      readonly path: string;
      readonly size: number;
      readonly text: string;
      /** The hash of the text on disk. A save names it, so a newer change is never lost. */
      readonly version: string;
      /** False when the redactor changed the text: a save would write its mark over the secret. */
      readonly editable: boolean;
    }
  | { readonly kind: "unreadable"; readonly path: string; readonly size: number; readonly reason: string };

/** A phone shows 1 MB of text slowly already, and a project file has the same limit. */
export const maxShownBytes = 1_000_000;
/** Git looks at the same amount to tell text from binary. */
const sniffBytes = 8_000;
/** Git data is not for people to read, and can hold a remote's token. */
const hiddenName = ".git";
/** Windows has no such flag, and no named pipe in a folder either. */
const noWait: number = (constants as Partial<typeof constants>).O_NONBLOCK ?? 0;

/**
 * Lists the folder or shows the file at `requested`, a forward-slash path from the vault root.
 * The empty path is the root. Throws `file_not_found` for a path that is missing or leaves the vault.
 */
export function browseVault(vaultPath: string, requested: string, redact: (text: string) => string): BrowsedPath {
  const { path, resolved, notFound } = resolveInVault(vaultPath, requested);
  try {
    if (statSync(resolved).isDirectory())
      return { kind: "folder", path, entries: listFolder(realpathSync(vaultPath), resolved) };
    return shownFile(path, readFile(path, resolved, notFound), redact);
  } catch (error) {
    if (error instanceof EvaError) throw error;
    if (errorCode(error) === "ENOENT") throw notFound;
    return { kind: "unreadable", path, size: 0, reason: "Eva has no permission to open this." };
  }
}

/**
 * Replaces the text of the file at `requested` with `edited`, with the line endings of the file
 * on disk. It never creates a file. Throws `file_changed` when the file is no longer at `version`,
 * and `file_not_writable` for a file that the page cannot edit. The idle sweep commits the change.
 */
export function saveVaultFile(
  vaultPath: string,
  requested: string,
  version: string,
  edited: string,
  redact: (text: string) => string,
): BrowsedPath {
  const { path, resolved, notFound } = resolveInVault(vaultPath, requested);
  try {
    if (statSync(resolved).isDirectory()) throw notWritable("A folder has no text to save.");
    const before = readFile(path, resolved, notFound);
    if (before.kind === "unreadable") throw notWritable(before.reason);
    if (redact(before.text) !== before.text) throw notWritable(readOnlyReason);
    if (fileVersion(before.text) !== version)
      throw new EvaError("file_changed", "The file changed since you opened it. Load it again, then redo your change.");
    const text = matchFileStyle(edited, before.text);
    if (Buffer.byteLength(text) > maxShownBytes)
      throw notWritable("The text is larger than 1 MB, so Eva does not save it.");
    if (text !== before.text) replaceText(resolved, text, before.stats);
    return shownFile(path, readFile(path, resolved, notFound), redact);
  } catch (error) {
    if (error instanceof EvaError) throw error;
    if (errorCode(error) === "ENOENT") throw notFound;
    throw notWritable("Eva has no permission to change this.");
  }
}

const readOnlyReason = "Eva hid a secret in this file, so she does not save it from the page.";

function notWritable(reason: string): EvaError {
  return new EvaError("file_not_writable", reason);
}

/**
 * Writes through a temporary file and a rename, so a reader never sees half a file. The new file
 * gets the old mode: git tracks the run bit, and a vault file must not turn private either.
 */
function replaceText(resolved: string, text: string, stats: Stats): void {
  const temporaryPath = `${resolved}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    writeFileSync(temporaryPath, text, { encoding: "utf-8", mode: 0o600 });
    chmodSync(temporaryPath, stats.mode & 0o7777);
    renameSync(temporaryPath, resolved);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** The vault path of `requested` and the real path it leads to, inside the vault and outside git data. */
function resolveInVault(
  vaultPath: string,
  requested: string,
): { readonly path: string; readonly resolved: string; readonly notFound: EvaError } {
  const path = normalizedPath(requested);
  const notFound = new EvaError("file_not_found", `${path === "" ? "The vault" : path} was not found.`);
  // Windows reads a colon in a name as a file stream, which a name check cannot see through.
  // Elsewhere a colon is a plain character, such as in `Meeting 10:30.md`.
  if (process.platform === "win32" && path.split("/").some((part) => part.includes(":"))) throw notFound;
  let root: string;
  let resolved: string;
  try {
    root = realpathSync(vaultPath);
    resolved = realpathSync(join(root, path));
  } catch {
    throw notFound;
  }
  // The resolved path decides, so a link named `notes.txt` that leads to `.env` or `.git` is caught too.
  if (!isInside(root, resolved) || isGitData(root, resolved)) throw notFound;
  return { path, resolved, notFound };
}

type ReadFile =
  | { readonly kind: "text"; readonly stats: Stats; readonly text: string }
  | { readonly kind: "unreadable"; readonly size: number; readonly reason: string };

function shownFile(path: string, read: ReadFile, redact: (text: string) => string): BrowsedPath {
  if (read.kind === "unreadable") return { kind: "unreadable", path, size: read.size, reason: read.reason };
  // The byte order mark stays on disk only: a save puts it back.
  const plain = read.text.replace(/^\uFEFF/, "");
  const text = redact(plain);
  return {
    kind: "file",
    path,
    size: read.stats.size,
    text,
    version: fileVersion(read.text),
    editable: text === plain,
  };
}

/**
 * Reads the open file, never the path again, so a file that changes meanwhile cannot slip past the
 * checks. A named pipe opens without a wait, so it can never block the core.
 */
function readFile(path: string, resolved: string, notFound: EvaError): ReadFile {
  const handle = openSync(resolved, constants.O_RDONLY | noWait);
  try {
    const stats = fstatSync(handle);
    if (!stats.isFile()) throw notFound;
    const unreadable = (reason: string): ReadFile => ({ kind: "unreadable", size: stats.size, reason });
    if (looksLikeSecretsFile(basename(resolved)) || looksLikeSecretsFile(basename(path)))
      return unreadable("This looks like a secrets file, so Eva does not show it.");
    if (stats.size > maxShownBytes) return unreadable("This file is larger than 1 MB, so Eva does not show it.");
    const bytes = Buffer.alloc(stats.size);
    const read = readSync(handle, bytes, 0, stats.size, 0);
    const text = textOf(bytes.subarray(0, read));
    if (text === null) return unreadable("This file is not plain text, so Eva cannot show it.");
    return { kind: "text", stats, text };
  } finally {
    closeSync(handle);
  }
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

/** Any part named `.git`, in any case: Windows and macOS read `.GIT` as the same folder. */
function isGitData(root: string, resolved: string): boolean {
  return relative(root, resolved)
    .split(sep)
    .some((part) => part.toLowerCase() === hiddenName);
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
}

/** Folders first, then files, each by name. A link counts as what it points to, when that is inside the vault. */
function listFolder(root: string, folder: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === hiddenName) continue;
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
    if (!isInside(root, resolved) || isGitData(root, resolved)) return { name, kind: "other", size: null };
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
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
