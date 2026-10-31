/**
 * The vault files of a widget (#691): `data/<input>/` in the folder that the person approved,
 * and `data/<input>` for an approved file. Each path passes the rules of `widget-places.ts`, and
 * no step follows a symbolic link: a link could lead to any file of the computer. A write keeps
 * the fields of the file on disk that the widget does not know, so the data of another widget stays.
 */
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, type Stats } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { writeFileAtomic } from "../../shared/files.ts";
import { looksLikeSecretsFile } from "../files/vault-files.ts";
import type { ApprovedPath } from "./widget-approvals.ts";
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

/** A write is at most 5 MB: a data file of a widget is small. */
export const maxWriteBytes = 5 * 1024 * 1024;
/** The vault sync leaves out a file over 50 MB, so a widget reads nothing larger. */
const maxReadBytes = 50 * 1024 * 1024;
/** A folder with more files is not a widget's data: the list stops there. */
const maxListed = 10_000;
const indexFile = "index.json";

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
  const path = isFolder ? `${approved.path}/${rest ?? ""}` : approved.path;
  const segments = openPath(path);
  // The approved place itself must still pass: the record names it, but the rules may be newer.
  if (segments === null || openPath(approved.path) === null) return notFound;
  if (method === "GET") return readData(vaultPath, segments);
  if (method !== "PUT" && method !== "DELETE") return { status: 405 };
  if (approved.access !== "write") return refused;
  const name = segments.at(-1) ?? "";
  if (!isWritableName(name) || (approved.files !== null && !matchesFiles(approved.files, name))) return refused;
  // A folder input never writes over the list that Eva gives at its `index.json`.
  if (isFolder && rest === indexFile) return refused;
  const depthOfPlace = (openPath(approved.path) ?? []).length;
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
  if (looksLikeSecretsFile(name) || isDataFormatFile(name)) return notFound;
  if (stats.size > maxReadBytes) return { status: 413 };
  return { status: 200, contentType: contentTypeOf(name), body: readFileSync(join(vaultPath, ...segments)) };
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
      else if (entryStats.isFile() && entryStats.nlink === 1 && listedFile(inner, entry, approved.files))
        names.push(inner.join("/"));
    }
  };
  visit([]);
  return { status: 200, contentType: contentTypes["json"] ?? "", body: JSON.stringify(names) };
}

function listedFile(inner: readonly string[], name: string, pattern: string | null): boolean {
  // The list itself answers at `index.json`, so a file of that name in the folder stays hidden.
  if (inner.length === 1 && name === indexFile) return false;
  if (isDataFormatFile(name) || looksLikeSecretsFile(name)) return false;
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
  const place = walk(vaultPath, segments.slice(0, depthOfPlace));
  if (place === null || (depthOfPlace < segments.length && !place.isDirectory())) return notFound;
  for (let index = depthOfPlace + 1; index < segments.length; index += 1) {
    const folder = join(vaultPath, ...segments.slice(0, index));
    const stats = lstatOrNull(folder);
    if (stats === null) mkdirSync(folder);
    else if (stats.isSymbolicLink() || !stats.isDirectory()) return refused;
  }
  const name = segments.at(-1) ?? "";
  const target = join(vaultPath, ...segments);
  const current = lstatOrNull(target);
  if (current !== null && (!current.isFile() || current.nlink > 1)) return refused;
  const yaml = /\.ya?ml$/i.test(name);
  const text = Buffer.from(write.body).toString("utf-8");
  const next = parseData(text, yaml);
  if (next === undefined) return { status: 400, contentType: "text/plain; charset=utf-8", body: "Not valid data." };
  let content = text;
  if (current !== null) {
    const before = parseData(readFileSync(target, "utf-8"), yaml);
    // A file that Eva cannot read keeps the person's text: Eva never writes over what she cannot merge.
    if (before === undefined) return { status: 409 };
    const merged = keepUnknownFields(before, next, write.schema);
    if (JSON.stringify(merged) !== JSON.stringify(next))
      content = yaml ? stringifyYaml(merged) : `${JSON.stringify(merged, null, 2)}\n`;
  }
  // The vault sync would push it, and a secret never goes in the vault.
  if (write.redact(content) !== content) return { status: 422 };
  writeFileAtomic(target, content);
  return { status: 204 };
}

function deleteData(vaultPath: string, segments: readonly string[], depthOfPlace: number): WidgetAnswer {
  if (walk(vaultPath, segments.slice(0, depthOfPlace)) === null) return notFound;
  const stats = walk(vaultPath, segments);
  if (!stats?.isFile()) return notFound;
  if (stats.nlink > 1) return refused;
  rmSync(join(vaultPath, ...segments));
  return { status: 204 };
}

/** The value of a JSON or YAML text, or undefined when it does not parse. */
function parseData(text: string, yaml: boolean): unknown {
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
