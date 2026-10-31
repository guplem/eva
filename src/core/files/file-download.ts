/**
 * The Download button of the file explorer: a file comes as itself, and a folder comes as one
 * zip file. A browser saves one file per link, so a folder needs the zip. The zip stores each
 * file with no compression: the core builds it fast, and every phone opens it.
 * The checks of the explorer apply: no path out of the vault, no git data, no secrets file, and
 * the text of each text file passes through the redactor.
 */
import { closeSync, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync, constants } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { isInside } from "../../shared/path-area.ts";
import { errorCode, isGitData, noWait, resolveInVault, textOf } from "./file-browser.ts";
import { isEncryptedOnDisk, secretMatcherOf, type SecretPaths } from "./secret-paths.ts";

export interface VaultDownload {
  /** The file name that the browser saves. */
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly zip: boolean;
}

/** The core holds the whole download in memory, so a large folder must not exhaust it. */
export const maxDownloadBytes = 200 * 1024 * 1024;
/** A zip without its 64-bit extension counts its entries in 16 bits. */
const maxZipEntries = 0xffff;
const tooLarge = (): EvaError =>
  new EvaError("file_not_downloadable", "This is larger than 200 MB, so Eva does not download it.");

/**
 * The file or the zipped folder at `requested`, a forward-slash path from the vault root.
 * Throws `file_not_found` for a path that is missing or leaves the vault, and
 * `file_not_downloadable` for a secrets file or a download larger than `limitBytes`.
 */
export function downloadVaultPath(
  vaultPath: string,
  requested: string,
  redact: (text: string) => string,
  limitBytes = maxDownloadBytes,
): VaultDownload {
  const { root, path, resolved, notFound } = resolveInVault(vaultPath, requested);
  const name = path === "" ? basename(root) : basename(path);
  const secrets = secretMatcherOf(root);
  try {
    if (statSync(resolved).isDirectory()) {
      const zip = new ZipWriter(limitBytes);
      addFolder(zip, root, resolved, name, new Set(), secrets, redact);
      return { name: `${name}.zip`, bytes: zip.finish(), zip: true };
    }
    // The encrypted bytes download from the Files page, which needs the password to open them (#707).
    if (isEncryptedOnDisk(resolved))
      throw new EvaError("file_not_downloadable", "This file is encrypted. Open it in the Files page to download it.");
    if (isSecret(root, secrets, [join(root, path), resolved]))
      throw new EvaError("file_not_downloadable", "This is a secret file, so Eva does not download it.");
    const file = readWhole(resolved, limitBytes);
    if (file === null) throw notFound;
    return { name, bytes: redacted(file.bytes, redact), zip: false };
  } catch (error) {
    if (error instanceof EvaError) throw error;
    if (errorCode(error) === "ENOENT") throw notFound;
    throw new EvaError("file_not_downloadable", "Eva has no permission to open this.");
  }
}

/** A link and its target both count: either path can match the list, and the header marks any name. */
function isSecret(root: string, secrets: SecretPaths, absolutePaths: readonly string[]): boolean {
  return absolutePaths.some(
    (path) => secrets.matches(relative(root, path).split(sep).join("/")) || isEncryptedOnDisk(path),
  );
}

/** Folders first, then files, each by name, as the explorer lists them. A folder seen once is skipped, so a link loop ends. */
function addFolder(
  zip: ZipWriter,
  root: string,
  folder: string,
  zipPath: string,
  seen: Set<string>,
  secrets: SecretPaths,
  redact: (text: string) => string,
): void {
  seen.add(folder);
  zip.addFolder(`${zipPath}/`, statSync(folder).mtime);
  const folders: [string, string][] = [];
  const files: [string, string][] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    let resolved: string;
    try {
      resolved = realpathSync(join(folder, entry.name));
    } catch {
      continue; // A broken link, or a file that went away meanwhile.
    }
    if (!isInside(root, resolved) || isGitData(root, resolved) || seen.has(resolved)) continue;
    const stats = statSync(resolved, { throwIfNoEntry: false });
    if (stats?.isDirectory() === true) folders.push([entry.name, resolved]);
    else if (stats?.isFile() === true && !isSecret(root, secrets, [join(folder, entry.name), resolved]))
      files.push([entry.name, resolved]);
  }
  const byName = (first: [string, string], second: [string, string]): number => first[0].localeCompare(second[0]);
  for (const [name, resolved] of folders.sort(byName))
    if (!seen.has(resolved)) addFolder(zip, root, resolved, `${zipPath}/${name}`, seen, secrets, redact);
  for (const [name, resolved] of files.sort(byName)) {
    let file: { readonly bytes: Uint8Array<ArrayBuffer>; readonly modified: Date } | null;
    try {
      file = readWhole(resolved, zip.room());
    } catch (error) {
      if (error instanceof EvaError) throw error;
      continue; // A file that Eva may not read, or that went away, stays out.
    }
    if (file !== null) zip.addFile(`${zipPath}/${name}`, redacted(file.bytes, redact), file.modified);
  }
}

/**
 * Reads the open file, never the path again, so a file that changes meanwhile cannot slip past the
 * checks. A named pipe opens without a wait, so it can never block the core. Null for no regular file.
 */
function readWhole(
  resolved: string,
  limitBytes: number,
): { readonly bytes: Uint8Array<ArrayBuffer>; readonly modified: Date } | null {
  const handle = openSync(resolved, constants.O_RDONLY | noWait);
  try {
    const stats = fstatSync(handle);
    if (!stats.isFile()) return null;
    if (stats.size > limitBytes) throw tooLarge();
    const bytes = Buffer.alloc(stats.size);
    const read = readSync(handle, bytes, 0, stats.size, 0);
    return { bytes: bytes.subarray(0, read), modified: stats.mtime };
  } finally {
    closeSync(handle);
  }
}

/** A text file with a secret comes as the page shows it. Other files keep their exact bytes. */
function redacted(bytes: Uint8Array<ArrayBuffer>, redact: (text: string) => string): Uint8Array<ArrayBuffer> {
  const text = textOf(bytes);
  if (text === null) return bytes;
  const shown = redact(text);
  return shown === text ? bytes : new TextEncoder().encode(shown);
}

/** A zip with stored entries only, and UTF-8 names. */
class ZipWriter {
  private readonly parts: Uint8Array[];
  private readonly directory: Uint8Array[];
  private readonly limitBytes: number;
  private offset: number;
  private count: number;

  constructor(limitBytes: number) {
    this.parts = [];
    this.directory = [];
    this.limitBytes = limitBytes;
    this.offset = 0;
    this.count = 0;
  }

  /** The bytes that a file may still take. */
  room(): number {
    return Math.max(0, this.limitBytes - this.offset);
  }

  addFolder(name: string, modified: Date): void {
    this.add(name, new Uint8Array(0), modified, 0x10);
  }

  addFile(name: string, data: Uint8Array, modified: Date): void {
    this.add(name, data, modified, 0);
  }

  finish(): Uint8Array<ArrayBuffer> {
    const directorySize = this.directory.reduce((total, part) => total + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, this.offset, true);
    return Buffer.concat([...this.parts, ...this.directory, new Uint8Array(end.buffer)]);
  }

  private add(name: string, data: Uint8Array, modified: Date, attributes: number): void {
    const nameBytes = new TextEncoder().encode(name);
    this.count += 1;
    if (this.count > maxZipEntries)
      throw new EvaError("file_not_downloadable", "This folder holds too many files, so Eva does not download it.");
    if (this.offset + 30 + nameBytes.byteLength + data.byteLength > this.limitBytes) throw tooLarge();
    const crc = Bun.hash.crc32(data);
    const { time, date } = dosTime(modified);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    // Bit 11 says that the name is UTF-8, so an accent stays an accent.
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, nameBytes.byteLength, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, nameBytes.byteLength, true);
    central.setUint32(38, attributes, true);
    central.setUint32(42, this.offset, true);

    this.parts.push(new Uint8Array(local.buffer), nameBytes, data);
    this.directory.push(new Uint8Array(central.buffer), nameBytes);
    this.offset += 30 + nameBytes.byteLength + data.byteLength;
  }
}

/** The local time in the two 16-bit MS-DOS fields that a zip uses. A zip cannot hold a year before 1980. */
function dosTime(when: Date): { readonly time: number; readonly date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}
