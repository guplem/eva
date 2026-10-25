/**
 * Files that reach a chat (lessons 72 to 74, 124). The model names a file with a marker line
 * in its answer: `src/shared/file-markers.ts` reads it.
 * Only a file inside the vault can be sent, and the path is resolved before the check, so
 * neither `..` nor a symbolic link can point out (lesson 72).
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";

export type SendableFile =
  | { readonly ok: true; readonly path: string; readonly relativePath: string; readonly name: string }
  | { readonly ok: false; readonly reason: string };

/** Telegram lets a bot upload at most 50 MB. */
export const maxSendableBytes = 50 * 1024 * 1024;
export const scratchFolderName = "Scratch";
/** Scratch files older than this are removed. */
const scratchMaxAgeMs = 7 * 24 * 60 * 60_000;
/** File names that hold secrets by convention; the vault's .gitignore names the same ones. */
const secretScanBytes = 2 * 1024 * 1024;
const secretNamePattern =
  /^\.env(\..*)?$|\.(pem|key|p12|pfx)$|^(\.npmrc|\.pypirc|\.netrc|secrets?\.json|credentials\.json|client_secret.*\.json)$/i;

/** True for a file name that holds secrets by convention, such as `.env` or `id.pem`. */
export function looksLikeSecretsFile(name: string): boolean {
  return secretNamePattern.test(name);
}

/** Resolves a path from the vault root and checks that it may be sent. */
export function resolveSendableFile(vaultPath: string, requested: string): SendableFile {
  if (isAbsolute(requested)) return { ok: false, reason: `${requested} is not a path from the vault root.` };
  let root: string;
  let resolved: string;
  try {
    root = realpathSync(vaultPath);
    resolved = realpathSync(join(root, requested));
  } catch {
    return { ok: false, reason: `${requested} does not exist.` };
  }
  const relativePath = relative(root, resolved);
  if (relativePath.startsWith("..") || isAbsolute(relativePath))
    return { ok: false, reason: `${requested} is outside the vault, so Eva does not send it.` };
  const parts = relativePath.split(sep);
  // Clones and git data can hold a project's secrets, which the owner allows inside a project only.
  if (parts.includes(".git") || (parts[0] === "Projects" && parts[2] === "repos"))
    return { ok: false, reason: `${requested} is in a repository folder, so Eva does not send it.` };
  if (looksLikeSecretsFile(basename(resolved)))
    return { ok: false, reason: `${requested} looks like a secrets file, so Eva does not send it.` };
  const stats = statSync(resolved);
  if (!stats.isFile()) return { ok: false, reason: `${requested} is not a file.` };
  if (stats.size > maxSendableBytes) return { ok: false, reason: `${requested} is larger than 50 MB.` };
  // Only text files are scanned; a large file is a document or a media file.
  if (stats.size <= secretScanBytes && containsSecretPattern(readFileSync(resolved, "utf8")))
    return { ok: false, reason: `${requested} holds a secret, so Eva does not send it.` };
  return { ok: true, path: resolved, relativePath: relativePath.split(sep).join("/"), name: basename(resolved) };
}

/** The ids behind offer buttons, on disk, so a button still works after a restart (lesson 124). */
export class OfferStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** The button id of a path: the same file keeps the same id, so the store grows only with new files. */
  idFor(relativePath: string): string {
    const id = createHash("sha256").update(relativePath).digest("hex").slice(0, 12);
    const offers = this.read();
    if (offers[id] !== relativePath)
      writeFileAtomic(this.path, JSON.stringify({ ...offers, [id]: relativePath }) + "\n");
    return id;
  }

  pathFor(id: string): string | null {
    return this.read()[id] ?? null;
  }

  private read(): Record<string, string> {
    const read = readJsonTolerant(this.path);
    if (!read.ok || typeof read.value !== "object" || read.value === null) return {};
    return Object.fromEntries(
      Object.entries(read.value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  }
}

/**
 * Saves a file that the person sent into `Scratch/received/`, named by its content, so two
 * chats that receive files at once never overwrite each other (lesson 74). Returns the path
 * from the vault root.
 */
export function saveReceivedFile(vaultPath: string, originalName: string, bytes: Uint8Array): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  // Cut by letters, not UTF-16 units, so no letter splits in two. 60 letters of 4 bytes each,
  // with the hash, stay under the 255-byte limit of a file name.
  const safeName =
    Array.from(basename(originalName).replace(/[^\p{L}\p{M}\p{N}_.-]+/gu, "-"))
      .slice(-60)
      .join("") || "file";
  const extension = extname(safeName);
  const name = `${safeName.slice(0, safeName.length - extension.length)}-${hash}${extension}`;
  const folder = join(vaultPath, scratchFolderName, "received");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), bytes);
  return `${scratchFolderName}/received/${name}`;
}

/** The line that tells the agent where a received file is. Every front end sends the same line. */
export function receivedFileNote(savedPath: string): string {
  return `[The person sent a file, saved as ${savedPath}]`;
}

/** Removes every Scratch file older than a week. Returns how many it removed. */
export function cleanScratch(vaultPath: string, now: Date): number {
  return cleanFolder(join(vaultPath, scratchFolderName), now);
}

/**
 * Walks the folder without following a symbolic link: a link in Scratch, from a vault push
 * or an agent, must never lead the cleanup to delete files elsewhere.
 */
function cleanFolder(folder: string, now: Date): number {
  let entries: Dirent[];
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      removed += cleanFolder(path, now);
    } else if (entry.isFile()) {
      try {
        if (now.getTime() - statSync(path).mtimeMs <= scratchMaxAgeMs) continue;
        rmSync(path, { force: true });
        removed += 1;
      } catch {
        // A file can go away after the folder read. A file that another program holds open goes at the next sweep.
      }
    }
  }
  return removed;
}
