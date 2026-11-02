/**
 * Finds the files of the pinned block (#769): the files with a `pinned` value, and the entity
 * files that their status pins. Eva reads the fixed entity files directly, so a large folder never
 * hides an open case. Only the manual pins need a walk of the vault. Every read is bounded, and the
 * walk follows no link, as the vault search does (lesson 72).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { noWait } from "../files/file-browser.ts";
import { secretMatcherOf, type SecretPaths } from "../files/secret-paths.ts";
import { frontMatterPattern, titleHeading } from "../projects/project-catalog.ts";
import { encryptedState } from "../vault/vault-crypto.ts";

/** How a file asks to be pinned. Null: no value, or a value that Eva does not know, so the status decides. */
export type PinnedValue = "full" | "summary" | "false" | null;
export const pinnedValues = ["full", "summary", "false"] as const;
/** The front matter keys that the pinned block reads on any file. A rename is a change of a stored format. */
export const pinnedFileKeys = ["summary", "pinned"] as const;
/** The keys that the block reads on `Case.md` and `Period.md`, besides `summary` and `pinned`. */
export const caseFileKeys = ["status", "next.date", "next.step", "deadline.date", "deadline.cost"] as const;
export const caseStatuses = ["open", "waiting"] as const;
export const periodFileKeys = ["status"] as const;
export const periodStatuses = ["open"] as const;

export type EntityKind = "case" | "period";

export interface PinnedFile {
  /** The forward-slash path from the vault root. */
  readonly path: string;
  readonly absolutePath: string;
  readonly kind: EntityKind | null;
  readonly pinned: PinnedValue;
  /** Every key of the front matter, as text (the failsafe schema). */
  readonly fields: Readonly<Record<string, unknown>>;
  /** The `> Important: <why>` line of a vault that the hub has not migrated yet, or null. */
  readonly oldImportant: string | null;
}

export interface PinnedFiles {
  /** The files with `pinned: full` or `summary`, found by the walk or by a direct read, with no duplicate. */
  readonly manual: readonly PinnedFile[];
  /** Every `Case.md` and `Period.md`, also those with a `pinned` value. */
  readonly entities: readonly PinnedFile[];
  /** False when the walk stopped at a budget before it saw the whole vault. */
  readonly complete: boolean;
}

/**
 * Enough for most front matter. Eva reads more only for a front matter that the head does not
 * close, so an ordinary vault stays far below the byte budget.
 */
const headBytes = 1024;
/** Enough for the `> Important:` line under a title too, for one release. */
const oldFormHeadBytes = 8 * 1024;
/** The walk blocks the core while it runs, also when the person opens the chat details. */
const maxVisitedEntries = 20_000;
const maxReadBytes = 20_000_000;
/** A larger full file cannot fit the cap of the block, so Eva never reads it whole. */
export const maxFullBytes = 64 * 1024;

const entityFolders: readonly { readonly folder: string; readonly file: string; readonly kind: EntityKind }[] = [
  { folder: "Life/Cases", file: "Case.md", kind: "case" },
  { folder: "Life/Periods", file: "Period.md", kind: "period" },
];

/**
 * The pinned files of the vault. `oldForm` reads a `> Important:` line as `pinned: summary`, for a
 * vault that the hub has not migrated yet.
 */
export function findPinnedFiles(vaultPath: string, options: { readonly oldForm: boolean }): PinnedFiles {
  let root: string;
  try {
    root = realpathSync(vaultPath);
  } catch {
    return { manual: [], entities: [], complete: true };
  }
  const secrets = secretMatcherOf(root);
  const unread: string[] = [];
  const entities = entityFolders.flatMap((entity) =>
    // A linked `Life/` or `Life/Cases/` could point out of the vault (lesson 72).
    !isRealFolder(root, entity.folder)
      ? []
      : childFolders(join(root, entity.folder)).flatMap((name) => {
          const path = `${entity.folder}/${name}/${entity.file}`;
          const read = readPinnedFile(root, path, entity.kind, secrets, options.oldForm);
          if (read.unread) unread.push(path);
          return read.file === null ? [] : [read.file];
        }),
  );
  const walk = walkVault(root, secrets, options.oldForm);
  const manual = new Map<string, PinnedFile>();
  for (const file of [...entities, ...walk.files]) {
    if ((file.pinned === "full" || file.pinned === "summary") && !manual.has(file.path)) manual.set(file.path, file);
  }
  return { manual: [...manual.values()], entities, complete: unread.length === 0 && walk.complete };
}

/** The whole text of a full file, or null when it is too large, unsafe or gone. */
export function readWholeFile(absolutePath: string): string | null {
  const read = readBounded(absolutePath, maxFullBytes);
  return read === null || read.cut ? null : read.text;
}

/** True when each part of the path is a folder, not a link. */
function isRealFolder(root: string, path: string): boolean {
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

/** Breadth-first, so the files near the root come first when the budget runs out. */
function walkVault(
  root: string,
  secrets: SecretPaths,
  oldForm: boolean,
): { readonly files: PinnedFile[]; readonly complete: boolean } {
  const files: PinnedFile[] = [];
  let complete = true;
  const budget = { entries: maxVisitedEntries, bytes: maxReadBytes };
  const queue: string[] = [""];
  for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
    for (const entry of entriesOf(join(root, folder))) {
      budget.entries -= 1;
      if (budget.entries < 0 || budget.bytes < 0) return { files, complete: false };
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.name.startsWith(".")) continue;
      if (entry.folder) {
        if (!skippedFolder(path)) queue.push(path);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      const read = readPinnedFile(root, path, null, secrets, oldForm);
      budget.bytes -= read.bytes;
      if (read.unread) complete = false;
      if (read.file !== null) files.push(read.file);
    }
  }
  return { files, complete };
}

/**
 * The old `Scratch/` at the root holds temporary files (#767), and a clone holds other chats' work.
 * A `node_modules` folder holds only code of others, and can hold many thousand files.
 */
function skippedFolder(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  if (parts.at(-1) === "node_modules") return true;
  if (parts.length === 1 && parts[0] === "scratch") return true;
  return parts[0] === "projects" && parts[2] === "repos" && parts.length === 3;
}

/**
 * The folders and regular files of a folder, by name. A link or a special file is left out, and so
 * is a name with a control character: a line break in a path could add a line to the prompt.
 */
function entriesOf(folder: string): { readonly name: string; readonly folder: boolean }[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isFile()) && !controlCharacter.test(entry.name))
      .map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))
      .sort((first, second) => first.name.localeCompare(second.name));
  } catch {
    return [];
  }
}

// eslint-disable-next-line no-control-regex -- the pattern looks for control characters on purpose.
const controlCharacter = /[\u0000-\u001f\u007f]/;

function childFolders(folder: string): string[] {
  return entriesOf(folder)
    .filter((entry) => entry.folder && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

interface PinnedRead {
  /** The file, or null when it is not pinned, not a plain note, or its front matter does not parse. */
  readonly file: PinnedFile | null;
  /** The bytes that Eva read, for the budget of the walk. */
  readonly bytes: number;
  /** True when the front matter is too long to read, so Eva cannot tell whether the file is pinned. */
  readonly unread: boolean;
}

function readPinnedFile(
  root: string,
  path: string,
  kind: EntityKind | null,
  secrets: SecretPaths,
  oldForm: boolean,
): PinnedRead {
  const none = (bytes: number, unread = false): PinnedRead => ({ file: null, bytes, unread });
  // A secret never reaches the prompt, even with `pinned: full`.
  if (secrets.matches(path)) return none(0);
  const absolutePath = join(root, path);
  try {
    if (!lstatSync(absolutePath).isFile()) return none(0);
  } catch {
    return none(0);
  }
  let head = readBounded(absolutePath, oldForm ? oldFormHeadBytes : headBytes);
  if (head === null) return none(0);
  let bytes = head.bytes;
  // A front matter that the head does not close: read up to the full-file limit for it.
  if (head.cut && /^\uFEFF?---\r?\n/.test(head.text) && !frontMatterPattern.test(head.text.replace(/^\uFEFF/, ""))) {
    head = readBounded(absolutePath, maxFullBytes);
    if (head === null) return none(bytes);
    bytes += head.bytes;
  }
  const text = head.text.replace(/^\uFEFF/, "");
  const match = frontMatterPattern.exec(text);
  if (match === null && head.cut && text.startsWith("---")) return none(bytes, true);
  let fields: Record<string, unknown> = {};
  if (match !== null) {
    try {
      const parsed: unknown = parseYaml(match[1] ?? "", { schema: "failsafe" });
      // A bad front matter never breaks a chat: the file counts as not pinned (lesson 54).
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return none(bytes);
      fields = parsed as Record<string, unknown>;
    } catch {
      return none(bytes);
    }
  }
  const value = fields["pinned"];
  const pinned = (pinnedValues as readonly unknown[]).includes(value) ? (value as PinnedValue) : null;
  const oldImportant = oldForm && !("pinned" in fields) ? importantLine(text.slice(match?.[0].length ?? 0)) : null;
  if (pinned === null && oldImportant === null && kind === null) return none(bytes);
  const file: PinnedFile = {
    path,
    absolutePath,
    kind,
    pinned: pinned ?? (oldImportant === null ? null : "summary"),
    fields,
    oldImportant,
  };
  return { file, bytes, unread: false };
}

/**
 * The reason of a `> Important: <why>` quote, when it is the first block under the title, or the
 * first block of the body. A quote of several lines gives one line.
 */
function importantLine(body: string): string | null {
  const heading = titleHeading(body);
  const rest = heading === null ? body : body.slice(heading.index + heading.length);
  const lines = rest.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1 || !/^>\s*Important:/.test(lines[start]?.trim() ?? "")) return null;
  const quote: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.trim().startsWith(">")) break;
    quote.push(line.trim().replace(/^>\s?/, ""));
  }
  const why = quote
    .join(" ")
    .replace(/^Important:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return why === "" ? null : why;
}

/**
 * At most `limit` bytes of a plain text file, or null. The open does not wait, so a pipe never
 * blocks the core. `cut` says that the file is larger than what Eva read.
 */
function readBounded(
  absolutePath: string,
  limit: number,
): { readonly text: string; readonly bytes: number; readonly cut: boolean } | null {
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
