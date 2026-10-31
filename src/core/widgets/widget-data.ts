/**
 * The vault files of a widget (#691): `data/<input>/` in the folder that the person approved,
 * and `data/<input>` for an approved file. Each path passes the rules of `widget-places.ts`, and
 * no step follows a symbolic link: a link could lead to any file of the computer. A write keeps
 * the fields of the file on disk that the widget does not know, so the data of another widget stays.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { writeFileAtomic } from "../../shared/files.ts";
import { isEncryptedOnDisk, secretMatcherOf, type SecretPaths } from "../files/secret-paths.ts";
import type { LastLocation } from "../vault/about-me.ts";
import type { ApprovedPath } from "./widget-approvals.ts";
import { checkData } from "./widget-contract.ts";
import { isDataFormatFile, isPlainName, isWritableName, matchesFiles, openPath } from "./widget-places.ts";

/** An approved path with a value: an empty input reaches nothing. */
export type OpenApprovedPath = ApprovedPath & { readonly path: string };

export interface WidgetAnswer {
  readonly status: number;
  readonly contentType?: string;
  readonly body?: string | Uint8Array;
}

export interface DataWrite {
  readonly body: Uint8Array;
  /** The JSON Schema of the input, parsed, or null: it tells which fields the widget knows. */
  readonly schema: unknown;
  readonly redact: (text: string) => string;
}

export interface DataPathOptions {
  readonly vaultPath: string;
  readonly paths: readonly ApprovedPath[];
  /** The decoded path after the token, which starts with `data/`. */
  readonly path: string;
  readonly method: string;
  readonly body: Uint8Array | null;
  /** The parsed schema of a written input, by its path in the widget, or null. */
  readonly schemaOf: (schema: string) => unknown;
  readonly exclusive: <Result>(work: () => Result) => Promise<Result>;
  readonly redact: (text: string) => string;
  /** Hears each file that a write changed, by its vault path. */
  readonly wrote: (path: string) => void;
}

/**
 * The answer of a `data/<input>` path: a read at once, and a write between two sync steps. The
 * installed widget and the preview of a clone (#693) answer their data paths the same way.
 */
export async function answerDataPath(options: DataPathOptions): Promise<WidgetAnswer> {
  const { path, method } = options;
  const second = path.split("/")[1];
  const approved = options.paths.find((candidate) => candidate.input === second);
  const value = approved?.path ?? null;
  if (approved === undefined || value === null || second === undefined) return { status: 404 };
  const prefix = `data/${second}`;
  const rest = path === prefix ? null : path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined;
  if (rest === undefined) return { status: 404 };
  const open = { ...approved, path: value };
  if (method === "GET" || method === "HEAD") return answerData(options.vaultPath, open, rest, "GET", null);
  const schema = method === "PUT" && approved.schema !== null ? options.schemaOf(approved.schema) : null;
  const body = options.body;
  const write = body === null ? null : { body, schema, redact: options.redact };
  return options.exclusive(() => {
    const answer = answerData(options.vaultPath, open, rest, method, write);
    if (method === "PUT" && answer.status === 204) options.wrote(rest === null ? value : `${value}/${rest}`);
    return answer;
  });
}

export function jsonAnswer(value: unknown): WidgetAnswer {
  return { status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(value) };
}

/** The location of the contract: no source, so a widget does not learn which device sent it. */
export function contractLocation(location: LastLocation | null): Omit<LastLocation, "source"> | null {
  if (location === null) return null;
  const { latitude, longitude, accuracy, at } = location;
  return { latitude, longitude, accuracy, at };
}

/** A write is at most 5 MB: a data file of a widget is small. */
export const maxWriteBytes = 5 * 1024 * 1024;
/** The vault sync leaves out a file over 50 MB, so a widget reads nothing larger. */
const maxReadBytes = 50 * 1024 * 1024;
/** A folder with more files is not a widget's data: the list stops there. */
const maxListed = 10_000;
const indexFile = "index.json";
/** Windows has no such flag. There the check of the same file stands alone. */
const noFollow: number = (constants as Partial<typeof constants>).O_NOFOLLOW ?? 0;

const contentTypes: Readonly<Record<string, string>> = {
  json: "application/json; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The type of a served file by its extension. An unknown type is plain bytes, never a page. */
export function contentTypeOf(name: string): string {
  const extension = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return contentTypes[extension] ?? "application/octet-stream";
}

/**
 * Answers one request to `data/<input>` or `data/<input>/<rest>`. `rest` is the decoded part
 * after the input, without its first slash, or null for no slash at all.
 */
export function answerData(
  vaultPath: string,
  approved: OpenApprovedPath,
  rest: string | null,
  method: string,
  write: DataWrite | null,
): WidgetAnswer {
  const isFolder = approved.type === "folder";
  // A file input has the path `data/<input>` alone; a folder input always has a name after it.
  if (isFolder !== (rest !== null)) return notFound;
  if (isFolder && method === "GET" && rest === indexFile) return listFolder(vaultPath, approved);
  // On a file system that ignores case, `INDEX.json` is the hidden file of the person at `index.json`.
  const isIndex = isFolder && rest?.toLowerCase() === indexFile;
  if (isIndex && method === "GET") return notFound;
  const path = isFolder ? `${approved.path}/${rest ?? ""}` : approved.path;
  const segments = openPath(path);
  // The approved place itself must still pass: the record names it, but the rules may be newer.
  if (segments === null || openPath(approved.path) === null) return notFound;
  if (method === "GET") return readData(vaultPath, segments);
  if (method !== "PUT" && method !== "DELETE") return { status: 405 };
  if (approved.access !== "write") return refused;
  const name = segments.at(-1) ?? "";
  if (!isWritableName(name) || (approved.files !== null && !matchesFiles(approved.files, name))) return refused;
  // A folder input never writes over the list that Eva gives at its `index.json`. A secret file is
  // never a widget's data: Eva does not read one, so no widget writes or deletes one either.
  if (isIndex || isSecretData(vaultPath, segments)) return refused;
  // A file input may write a file that does not exist yet, in the folder that holds it.
  const depthOfPlace = isFolder ? (openPath(approved.path) ?? []).length : segments.length - 1;
  return method === "PUT"
    ? writeData(vaultPath, segments, depthOfPlace, write)
    : deleteData(vaultPath, segments, depthOfPlace);
}

const notFound: WidgetAnswer = { status: 404 };
const refused: WidgetAnswer = { status: 403 };

function readData(vaultPath: string, segments: readonly string[]): WidgetAnswer {
  const stats = walk(vaultPath, segments);
  // A hard link can name a file of another place, such as `Life/About me.md`, from inside the folder.
  if (!stats?.isFile() || stats.nlink > 1) return notFound;
  const name = segments.at(-1) ?? "";
  if (isSecretData(vaultPath, segments) || isDataFormatFile(name)) return notFound;
  if (stats.size > maxReadBytes) return { status: 413 };
  const bytes = readSame(join(vaultPath, ...segments), stats);
  return bytes === null ? notFound : { status: 200, contentType: contentTypeOf(name), body: bytes };
}

/** The text of a data file at a path from the vault root, by the same rules as a widget read, or null. */
export function readVaultData(vaultPath: string, path: string): string | null {
  const segments = openPath(path);
  const answer = segments === null ? notFound : readData(vaultPath, segments);
  return answer.status === 200 && answer.body !== undefined ? Buffer.from(answer.body).toString("utf-8") : null;
}

/**
 * The lstat of the last segment, after a check that no segment from the vault root is a link.
 * Null when a segment is missing or is not what the path needs.
 */
function walk(vaultPath: string, segments: readonly string[]): Stats | null {
  let stats: Stats | null = null;
  for (let index = 1; index <= segments.length; index += 1) {
    stats = lstatOrNull(join(vaultPath, ...segments.slice(0, index)));
    if (stats === null || stats.isSymbolicLink()) return null;
    if (index < segments.length && !stats.isDirectory()) return null;
  }
  return stats;
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Each file of the folder and its subfolders, by its path from the folder, that the pattern takes. */
function listFolder(vaultPath: string, approved: OpenApprovedPath): WidgetAnswer {
  const segments = openPath(approved.path);
  const stats = segments === null ? null : walk(vaultPath, segments);
  if (segments === null || !stats?.isDirectory()) return notFound;
  const names: string[] = [];
  const secrets = secretMatcherOf(vaultPath);
  const visit = (relative: readonly string[]): void => {
    let entries: string[];
    try {
      entries = readdirSync(join(vaultPath, ...segments, ...relative)).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (names.length >= maxListed) return;
      const inner = [...relative, entry];
      if (!isPlainName(entry) || openPath([...segments, ...inner].join("/")) === null) continue;
      const entryStats = lstatOrNull(join(vaultPath, ...segments, ...inner));
      if (entryStats === null || entryStats.isSymbolicLink()) continue;
      if (entryStats.isDirectory()) visit(inner);
      else if (
        entryStats.isFile() &&
        entryStats.nlink === 1 &&
        listedFile(inner, entry, approved.files) &&
        !isSecretData(vaultPath, [...segments, ...inner], secrets)
      )
        names.push(inner.join("/"));
    }
  };
  visit([]);
  return { status: 200, contentType: contentTypes["json"] ?? "", body: JSON.stringify(names) };
}

function listedFile(inner: readonly string[], name: string, pattern: string | null): boolean {
  // The list itself answers at `index.json`, so a file of that name in the folder stays hidden.
  if (inner.length === 1 && name.toLowerCase() === indexFile) return false;
  if (isDataFormatFile(name)) return false;
  return pattern === null || matchesFiles(pattern, name);
}

function writeData(
  vaultPath: string,
  segments: readonly string[],
  depthOfPlace: number,
  write: DataWrite | null,
): WidgetAnswer {
  if (write === null) return { status: 400 };
  if (write.body.byteLength > maxWriteBytes) return { status: 413 };
  // The approved place must exist; a folder inside it may be new.
  if (!isFolderPlace(vaultPath, segments.slice(0, depthOfPlace))) return notFound;
  const newFolders: string[] = [];
  for (let index = depthOfPlace + 1; index < segments.length; index += 1) {
    const folder = join(vaultPath, ...segments.slice(0, index));
    const stats = newFolders.length > 0 ? null : lstatOrNull(folder);
    if (stats === null) newFolders.push(folder);
    else if (stats.isSymbolicLink() || !stats.isDirectory()) return refused;
  }
  const name = segments.at(-1) ?? "";
  const target = join(vaultPath, ...segments);
  const current = newFolders.length > 0 ? null : lstatOrNull(target);
  if (current !== null && (!current.isFile() || current.nlink > 1)) return refused;
  const yaml = /\.ya?ml$/i.test(name);
  const text = Buffer.from(write.body).toString("utf-8");
  const next = parseData(text, yaml);
  if (next === undefined) return { status: 400, contentType: "text/plain; charset=utf-8", body: "Not valid data." };
  let content = text;
  let written: unknown = next;
  if (current !== null) {
    const onDisk = readSame(target, current);
    const before = onDisk === null ? undefined : parseData(Buffer.from(onDisk).toString("utf-8"), yaml);
    // A file that Eva cannot read keeps the person's text: Eva never writes over what she cannot merge.
    if (before === undefined) return { status: 409 };
    written = keepUnknownFields(before, next, write.schema);
    if (JSON.stringify(written) !== JSON.stringify(next))
      content = yaml ? stringifyYaml(written) : `${JSON.stringify(written, null, 2)}\n`;
  }
  // Only the writer's own schema (#692): the fields of the other widgets are the agent's to fill.
  const problems = checkData(written, write.schema);
  if (problems.length > 0)
    return {
      status: 422,
      contentType: "text/plain; charset=utf-8",
      body: `The file does not fit the format of this widget: ${problems.join("; ")}.`,
    };
  // The vault sync would push it, and a secret never goes in the vault.
  if (write.redact(content) !== content) return { status: 422 };
  // Only now: a refused write leaves no new folder behind.
  for (const folder of newFolders) mkdirSync(folder);
  writeFileAtomic(target, content);
  return { status: 204 };
}

function deleteData(vaultPath: string, segments: readonly string[], depthOfPlace: number): WidgetAnswer {
  if (!isFolderPlace(vaultPath, segments.slice(0, depthOfPlace))) return notFound;
  const stats = walk(vaultPath, segments);
  if (!stats?.isFile()) return notFound;
  if (stats.nlink > 1) return refused;
  rmSync(join(vaultPath, ...segments));
  return { status: 204 };
}

/** True for a folder with no link on the way from the vault root. No segments: the vault root itself. */
function isFolderPlace(vaultPath: string, segments: readonly string[]): boolean {
  return segments.length === 0 || walk(vaultPath, segments)?.isDirectory() === true;
}

/**
 * The bytes of the file that `checked` describes, or null. The file opens with no link at its
 * end, and must be the same file as the check found: a link that replaced a folder on the way
 * since the check leads to another file, which Eva never reads.
 */
function readSame(path: string, checked: Stats): Uint8Array | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.ino !== checked.ino || opened.dev !== checked.dev || opened.nlink > 1) return null;
    return readFileSync(descriptor);
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/** The value of a JSON or YAML text, or undefined when it does not parse. */
export function parseData(text: string, yaml: boolean): unknown {
  try {
    return yaml ? (parseYaml(text) as unknown) : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/**
 * `next`, plus each field of `before` that `next` leaves out and that the schema does not name
 * at that level. Inside a field that is an object on both sides, the same rule applies. A list
 * is the widget's own: it comes from `next` as it is, and the widget keeps the fields of its items.
 */
export function keepUnknownFields(before: unknown, next: unknown, schema: unknown): unknown {
  if (!isObject(before) || !isObject(next)) return next;
  const known = isObject(schema) && isObject(schema["properties"]) ? schema["properties"] : {};
  const merged: Record<string, unknown> = { ...next };
  for (const [key, value] of Object.entries(before)) {
    const inNext = Object.hasOwn(next, key);
    if (!inNext && Object.hasOwn(known, key)) continue;
    const kept = inNext ? keepUnknownFields(value, next[key], known[key]) : value;
    // A defined property, so a key such as `__proto__` stays a plain field.
    Object.defineProperty(merged, key, { value: kept, enumerable: true, writable: true, configurable: true });
  }
  return merged;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * What a picked path is, for the check at the approval: a folder, a file, a path that does not
 * exist yet in a folder that does ("missing"), or null for a path that a widget may never reach.
 */
export function placeOf(vaultPath: string, path: string): "folder" | "file" | "missing" | null {
  const segments = openPath(path);
  if (segments === null) return null;
  const stats = walk(vaultPath, segments);
  if (stats?.isDirectory() === true) return "folder";
  if (stats?.isFile() === true) return "file";
  if (stats !== null) return null;
  const parentIsFolder = segments.length === 1 || walk(vaultPath, segments.slice(0, -1))?.isDirectory() === true;
  // A link or a special file is never a place, and a missing file needs a folder that exists.
  if (lstatOrNull(join(vaultPath, ...segments)) !== null) return null;
  return parentIsFolder ? "missing" : null;
}

/** A secret file of the vault's list, or an encrypted file of any name, is never a widget's data (#707). */
function isSecretData(
  vaultPath: string,
  segments: readonly string[],
  secrets: SecretPaths = secretMatcherOf(vaultPath),
): boolean {
  return secrets.matches(segments.join("/")) || isEncryptedOnDisk(join(vaultPath, ...segments));
}
