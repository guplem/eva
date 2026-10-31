/**
 * The file explorer of the web page (issue 253): it lists a vault folder, shows a text file, saves
 * the person's edit of one (issue 308), and renames a file or a folder (issue 343). Each path is
 * resolved before the check, so neither `..` nor a symbolic link can point out of the vault (lesson 72).
 */
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
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
import { basename, dirname, join, relative, sep } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { isInside } from "../../shared/path-area.ts";
import { projectTitleOf } from "../projects/project-catalog.ts";
import { fileVersion, matchFileStyle } from "../projects/project-file.ts";
import { looksLikeSecretsFile } from "./vault-files.ts";

export interface FileEntry {
  readonly name: string;
  /** "other" is a link that leads out of the vault or nowhere, or a special file. It does not open. */
  readonly kind: "folder" | "file" | "other";
  /** Bytes, for a file only. */
  readonly size: number | null;
  /** The project title, for a project folder in `Projects/` only. The Files page can show it as the name. */
  readonly title?: string;
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
  | {
      readonly kind: "unreadable";
      readonly path: string;
      readonly size: number;
      readonly reason: string;
      /** False for a secrets file or a file that Eva may not read: the Download button cannot fetch it either. */
      readonly downloadable: boolean;
    };

/** A phone shows 1 MB of text slowly already, and a project file has the same limit. */
export const maxShownBytes = 1_000_000;
/** Git looks at the same amount to tell text from binary. */
const sniffBytes = 8_000;
/** Git data is not for people to read, and can hold a remote's token. */
const hiddenName = ".git";
/** Windows has no such flag, and no named pipe in a folder either. */
export const noWait: number = (constants as Partial<typeof constants>).O_NONBLOCK ?? 0;

/**
 * Lists the folder or shows the file at `requested`, a forward-slash path from the vault root.
 * The empty path is the root. Throws `file_not_found` for a path that is missing or leaves the vault.
 */
export function browseVault(vaultPath: string, requested: string, redact: (text: string) => string): BrowsedPath {
  const { root, path, resolved, notFound } = resolveInVault(vaultPath, requested);
  try {
    if (statSync(resolved).isDirectory()) return { kind: "folder", path, entries: listFolder(root, resolved) };
    return shownFile(path, readFile(path, resolved, notFound), redact);
  } catch (error) {
    if (error instanceof EvaError) throw error;
    if (errorCode(error) === "ENOENT") throw notFound;
    return { kind: "unreadable", path, size: 0, reason: "Eva has no permission to open this.", downloadable: false };
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
    // The idle sweep would commit and push it, and a secret never goes in the vault.
    if (redact(text) !== text) throw notWritable("The text holds a secret, such as a token, so Eva does not save it.");
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

/**
 * Gives the file or folder at `requested` the new `name` in the same folder, and answers its new
 * path. A link gets the new name, never its target. Throws `file_not_writable` for a name that is
 * taken or not allowed, and for an entry of the vault layout. The idle sweep commits the change.
 */
export function renameVaultEntry(vaultPath: string, requested: string, name: string): string {
  const { root, path, notFound } = resolveInVault(vaultPath, requested);
  if (path === "") throw notWritable("The vault folder keeps its name.");
  const parts = path.split("/");
  const oldName = parts.pop() ?? "";
  if (oldName === "..") throw notFound;
  const nameProblem = problemOfName(name);
  if (nameProblem !== null) throw notWritable(nameProblem);
  const folder = resolveInVault(vaultPath, parts.join("/")).resolved;
  const folderParts = relative(root, folder)
    .split(sep)
    .filter((part) => part !== "");
  if (isLayoutEntry([...folderParts, oldName]) || isLayoutEntry([...folderParts, name]))
    throw notWritable("Eva finds her settings and projects by this name, so it stays.");
  if (looksLikeSecretsFile(oldName) || looksLikeSecretsFile(name))
    throw notWritable("A secrets file stays out of reach of the page, so Eva does not rename it.");
  const newPath = [...parts, name].join("/");
  if (name === oldName) return newPath;
  const source = join(folder, oldName);
  const target = join(folder, name);
  try {
    // A file system that ignores case finds the entry itself at a name that changes only the case.
    if (existsAt(target) && !sameEntry(source, target))
      throw notWritable(`${name} is in this folder already. Pick another name.`);
    renameSync(source, target);
  } catch (error) {
    if (error instanceof EvaError) throw error;
    if (errorCode(error) === "ENOENT") throw notFound;
    throw notWritable("Eva has no permission to rename this.");
  }
  return newPath;
}

/** Windows cannot hold these characters or these device names, and the vault goes to every machine. */
const forbiddenCharacters = /[<>:"/\\|?*]/;
const deviceName = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
/** Most file systems hold at most 255 bytes in a name. */
const maxNameBytes = 255;

function problemOfName(name: string): string | null {
  if (name === "" || name === "." || name === "..") return "Give the file or folder a name.";
  if (forbiddenCharacters.test(name) || hasControlCharacter(name))
    return 'A name cannot hold these characters: < > : " / \\ | ? * or a control character.';
  if (name.endsWith(".") || name.endsWith(" ")) return "A name cannot end with a dot or a space.";
  if (deviceName.test(name)) return `Windows keeps the name ${name} for a device. Pick another name.`;
  if (name.toLowerCase() === hiddenName) return "Git keeps this name for its own data.";
  if (Buffer.byteLength(name) > maxNameBytes) return "The name is too long.";
  return null;
}

function hasControlCharacter(name: string): boolean {
  for (let index = 0; index < name.length; index += 1) if (name.charCodeAt(index) < 32) return true;
  return false;
}

/** `.eva`, `Projects`, each project folder, its `repos` folder and each clone: the layout contract. */
function isLayoutEntry(parts: readonly string[]): boolean {
  const lower = parts.map((part) => part.toLowerCase());
  if (lower.length === 1) return lower[0] === ".eva" || lower[0] === "projects";
  if (lower[0] !== "projects") return false;
  return lower.length === 2 || (lower[2] === "repos" && lower.length <= 4);
}

/** True for any entry at `path`, a broken link too. */
function existsAt(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function sameEntry(first: string, second: string): boolean {
  const one = lstatSync(first);
  const other = lstatSync(second);
  return one.dev === other.dev && one.ino === other.ino;
}

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
    // "wx" never opens a file that is there already, such as a link that another program put at this name.
    writeFileSync(temporaryPath, text, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    chmodSync(temporaryPath, stats.mode & 0o7777);
    renameSync(temporaryPath, resolved);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** The vault path of `requested` and the real path it leads to, inside the vault and outside git data. */
export function resolveInVault(
  vaultPath: string,
  requested: string,
): { readonly root: string; readonly path: string; readonly resolved: string; readonly notFound: EvaError } {
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
  return { root, path, resolved, notFound };
}

type ReadFile =
  | { readonly kind: "text"; readonly stats: Stats; readonly text: string }
  | { readonly kind: "unreadable"; readonly size: number; readonly reason: string; readonly downloadable: boolean };

function shownFile(path: string, read: ReadFile, redact: (text: string) => string): BrowsedPath {
  if (read.kind === "unreadable")
    return { kind: "unreadable", path, size: read.size, reason: read.reason, downloadable: read.downloadable };
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
    const unreadable = (reason: string, downloadable = true): ReadFile => ({
      kind: "unreadable",
      size: stats.size,
      reason,
      downloadable,
    });
    if (looksLikeSecretsFile(basename(resolved)) || looksLikeSecretsFile(basename(path)))
      return unreadable("This looks like a secrets file, so Eva does not show it.", false);
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
export function normalizedPath(requested: string): string {
  return requested
    .split(/[/\\]/)
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

/** Any part named `.git`, in any case: Windows and macOS read `.GIT` as the same folder. */
export function isGitData(root: string, resolved: string): boolean {
  return relative(root, resolved)
    .split(sep)
    .some((part) => part.toLowerCase() === hiddenName);
}

export function errorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
}

/** Folders first, then files, each by name. A link counts as what it points to, when that is inside the vault. */
function listFolder(root: string, folder: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === hiddenName) continue;
    const path = join(folder, entry.name);
    const described = describeEntry(root, path, entry.name);
    const title = described.kind === "folder" ? projectTitleIn(root, path) : null;
    entries.push(title === null ? described : { ...described, title });
  }
  const order = { folder: 0, file: 1, other: 2 };
  return entries.sort(
    (first, second) => order[first.kind] - order[second.kind] || first.name.localeCompare(second.name),
  );
}

/** The front matter and the title of a project file come first, so a title read needs no more. */
const titleBytes = 64_000;

/**
 * The project title of `folder`, a folder in the vault's `Projects/`, or null. An `AGENTS.md` link
 * that leads out of the vault gives no title, so the page never shows a line of a file outside it.
 * The read goes through the open file, as `readFile` does, so a named pipe never blocks the core.
 */
export function projectTitleIn(root: string, folder: string): string | null {
  // `Projects` in any case, as `isLayoutEntry` reads it.
  if (relative(root, dirname(folder)).toLowerCase() !== "projects") return null;
  let handle: number;
  try {
    const agentsFile = realpathSync(join(folder, "AGENTS.md"));
    if (!isInside(root, agentsFile) || isGitData(root, agentsFile)) return null;
    handle = openSync(agentsFile, constants.O_RDONLY | noWait);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(handle).isFile()) return null;
    const bytes = Buffer.alloc(titleBytes);
    const read = readSync(handle, bytes, 0, titleBytes, 0);
    // A full read can end inside a letter of several bytes. A line break never does.
    const end = read < titleBytes ? read : bytes.lastIndexOf(0x0a, read - 1) + 1;
    const text = textOf(bytes.subarray(0, end));
    return text === null ? null : projectTitleOf(text, basename(folder));
  } catch {
    return null;
  } finally {
    closeSync(handle);
  }
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
export function textOf(bytes: Uint8Array): string | null {
  if (bytes.subarray(0, sniffBytes).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
