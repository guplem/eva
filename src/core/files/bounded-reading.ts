/**
 * Safe reads of vault notes that Eva reads by herself, such as the pinned block and the Life pages.
 * Every read is bounded, and nothing follows a link, as the vault search does (lesson 72).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { encryptedState } from "../vault/vault-crypto.ts";
import { noWait } from "./file-browser.ts";

export interface BoundedText {
  readonly text: string;
  readonly bytes: number;
  /** True when the file is larger than what Eva read. */
  readonly cut: boolean;
}

/**
 * At most `limit` bytes of a plain text file, or null. The open does not wait, so a pipe never
 * blocks the core.
 */
export function readBounded(absolutePath: string, limit: number): BoundedText | null {
  let handle: number;
  try {
    handle = openSync(absolutePath, constants.O_RDONLY | noWait);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(handle);
    if (!stats.isFile()) return null;
    const bytes = Buffer.alloc(Math.min(stats.size, limit));
    const read = bytes.subarray(0, readSync(handle, bytes, 0, bytes.length, 0));
    // An encrypted file holds no words of its own, whatever its name.
    if (encryptedState(read) !== "plain" || read.includes(0)) return null;
    // Not fatal: a head can cut a character in two.
    return {
      text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(read),
      bytes: read.length,
      cut: stats.size > read.length,
    };
  } catch {
    return null;
  } finally {
    closeSync(handle);
  }
}

/** True when each part of the forward-slash path under `root` is a folder, not a link. */
export function isRealFolder(root: string, path: string): boolean {
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    try {
      if (!lstatSync(current).isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * The folders and regular files of a folder, by name. A link or a special file is left out, and so
 * is a name with a control character: a line break in a path could add a line to the prompt.
 */
export function entriesOf(folder: string): { readonly name: string; readonly folder: boolean }[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isFile()) && !hasControlCharacter(entry.name))
      .map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))
      .sort((first, second) => first.name.localeCompare(second.name));
  } catch {
    return [];
  }
}

// eslint-disable-next-line no-control-regex -- the pattern looks for control characters on purpose.
const controlCharacter = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

export function hasControlCharacter(name: string): boolean {
  return controlCharacter.test(name);
}

/** The real folders in a folder whose name does not start with a dot. */
export function childFolders(folder: string): string[] {
  return entriesOf(folder)
    .filter((entry) => entry.folder && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}
