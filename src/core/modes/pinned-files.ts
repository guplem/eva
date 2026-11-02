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

/** Enough for the front matter of a note, and for the line under its title. */
const headBytes = 8 * 1024;
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
  const entities = entityFolders.flatMap((entity) =>
    childFolders(join(root, entity.folder)).flatMap((name) => {
      const path = `${entity.folder}/${name}/${entity.file}`;
      const file = readPinnedFile(root, path, entity.kind, secrets, options.oldForm, null);
      return file === null ? [] : [file];
    }),
  );
  const walk = walkVault(root, secrets, options.oldForm);
  const manual = new Map<string, PinnedFile>();
  for (const file of [...entities, ...walk.files]) {
    if ((file.pinned === "full" || file.pinned === "summary") && !manual.has(file.path)) manual.set(file.path, file);
  }
  return { manual: [...manual.values()], entities, complete: walk.complete };
}

/** The whole text of a full file, or null when it is too large, unsafe or gone. */
export function readWholeFile(absolutePath: string): string | null {
  return readBounded(absolutePath, maxFullBytes, true);
}

/** Breadth-first, so the files near the root come first when the budget runs out. */
function walkVault(
  root: string,
  secrets: SecretPaths,
  oldForm: boolean,
): { readonly files: PinnedFile[]; readonly complete: boolean } {
  const files: PinnedFile[] = [];
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
      budget.bytes -= headBytes;
      const file = readPinnedFile(root, path, null, secrets, oldForm, budget);
      if (file !== null) files.push(file);
    }
  }
  return { files, complete: true };
}

/** The old `Scratch/` at the root holds temporary files (#767), and a clone holds other chats' work. */
function skippedFolder(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  if (parts.length === 1 && parts[0] === "scratch") return true;
  return parts[0] === "projects" && parts[2] === "repos" && parts.length === 3;
}

/** The folders and regular files of a folder, by name. A link or a special file is left out. */
function entriesOf(folder: string): { readonly name: string; readonly folder: boolean }[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))
      .sort((first, second) => first.name.localeCompare(second.name));
  } catch {
    return [];
  }
}

function childFolders(folder: string): string[] {
  return entriesOf(folder)
    .filter((entry) => entry.folder && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

/** The file's front matter, or null when the file is not a plain note, or its front matter does not parse. */
function readPinnedFile(
  root: string,
  path: string,
  kind: EntityKind | null,
  secrets: SecretPaths,
  oldForm: boolean,
  budget: { bytes: number } | null,
): PinnedFile | null {
  // A secret never reaches the prompt, even with `pinned: full`.
  if (secrets.matches(path)) return null;
  const absolutePath = join(root, path);
  try {
    if (!lstatSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  const head = readBounded(absolutePath, headBytes, false);
  if (head === null) return null;
  if (budget !== null) budget.bytes += headBytes - Buffer.byteLength(head);
  const text = head.replace(/^\uFEFF/, "");
  const match = frontMatterPattern.exec(text);
  let fields: Record<string, unknown> = {};
  if (match !== null) {
    try {
      const parsed: unknown = parseYaml(match[1] ?? "", { schema: "failsafe" });
      // A bad front matter never breaks a chat: the file counts as not pinned (lesson 54).
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      fields = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const value = fields["pinned"];
  const pinned = (pinnedValues as readonly unknown[]).includes(value) ? (value as PinnedValue) : null;
  const oldImportant = oldForm && !("pinned" in fields) ? importantLine(text.slice(match?.[0].length ?? 0)) : null;
  if (pinned === null && oldImportant === null && kind === null) return null;
  return {
    path,
    absolutePath,
    kind,
    pinned: pinned ?? (oldImportant === null ? null : "summary"),
    fields,
    oldImportant,
  };
}

/** The reason of a `> Important: <why>` line, when it is the first line under the title, or the first line of the body. */
function importantLine(body: string): string | null {
  const heading = titleHeading(body);
  const rest = heading === null ? body : body.slice(heading.index + heading.length);
  const first = rest.split("\n").find((line) => line.trim() !== "") ?? "";
  const why = /^>\s*Important:\s*(.+)$/.exec(first.trim())?.[1]?.trim();
  return why === undefined || why === "" ? null : why;
}

/**
 * At most `limit` bytes of a plain text file, or null. The open does not wait, so a pipe never
 * blocks the core. `whole` returns null for a larger file instead of its head.
 */
function readBounded(absolutePath: string, limit: number, whole: boolean): string | null {
  let handle: number;
  try {
    handle = openSync(absolutePath, constants.O_RDONLY | noWait);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(handle);
    if (!stats.isFile() || (whole && stats.size > limit)) return null;
    const bytes = Buffer.alloc(Math.min(stats.size, limit));
    const read = bytes.subarray(0, readSync(handle, bytes, 0, bytes.length, 0));
    // An encrypted file holds no words of its own, whatever its name.
    if (encryptedState(read) !== "plain" || read.includes(0)) return null;
    // Not fatal: a head can cut a character in two.
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(read);
  } catch {
    return null;
  } finally {
    closeSync(handle);
  }
}
