/**
 * The entities of `Life/` for the Life pages of the web app (#911): cases, people, objects, pets
 * and periods. Each is a folder with a main file of a fixed name. Eva reads them tolerantly: a bad
 * main file gives a warning and never hides the others. Every read is bounded and follows no link.
 */
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { lifeKindPlaces, type LifeKind } from "../../shared/life-kinds.ts";
import { childFolders, entriesOf, hasControlCharacter, isRealFolder, readBounded } from "../files/bounded-reading.ts";
import { secretMatcherOf, type SecretPaths } from "../files/secret-paths.ts";
import { frontMatterPattern, oneLineSummary, titleHeading } from "../projects/project-catalog.ts";

export interface LifeEntity {
  readonly kind: LifeKind;
  /** The folder name. It is the id in the address. */
  readonly id: string;
  /** From the vault root, such as "Life/Cases/2026-05-15-phone-repair". */
  readonly folder: string;
  /** The path of the main file, from the vault root. */
  readonly path: string;
  /** The first heading of the text, or else a readable form of the folder name. */
  readonly title: string;
  readonly summary: string | null;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  /** The other keys of the front matter, as the failsafe parser gives them: text, lists and maps. */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
}

export interface LifeEntityFile {
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "folder";
}

export interface LifeEntityDetail extends LifeEntity {
  /** The text under the front matter, cut at a limit. */
  readonly body: string;
  /** The files and folders beside the main file. */
  readonly files: readonly LifeEntityFile[];
}

/**
 * The most that Eva reads of one main file, front matter and text together. A main file holds
 * keys and short dated lines, and its evidence sits beside it, so a larger file is rare. The list
 * reads every main file of a kind, so the limit also bounds the list.
 */
export const maxBodyBytes = 64 * 1024;
/** The list blocks the core while it reads, so a huge folder shows only its first entities by id. */
const maxEntities = 2_000;
/** The page lists the files beside a main file. A folder of thousands of photos shows the first ones. */
const maxFiles = 500;

/** The entities of one kind, sorted by id. A missing folder gives none. */
export function discoverLifeEntities(vaultPath: string, kind: LifeKind): LifeEntity[] {
  const root = realRoot(vaultPath);
  if (root === null) return [];
  const folder = lifeKindPlaces[kind].folder;
  // A linked `Life/` could point out of the vault (lesson 72).
  if (!isRealFolder(root, folder)) return [];
  const secrets = secretMatcherOf(root);
  return childFolders(join(root, folder))
    .sort(byId)
    .slice(0, maxEntities)
    .flatMap((id) => {
      const read = readEntity(root, kind, id, secrets);
      return read === null ? [] : [read.entity];
    });
}

/** One entity with its text and the files beside it, or null when the id names no entity. */
export function readLifeEntity(vaultPath: string, kind: LifeKind, id: string): LifeEntityDetail | null {
  if (!isFolderName(id)) return null;
  const root = realRoot(vaultPath);
  if (root === null) return null;
  const folder = lifeKindPlaces[kind].folder;
  if (!isRealFolder(root, folder)) return null;
  // The id comes from the address: Eva finds it in the listing, never through a joined path.
  if (!childFolders(join(root, folder)).includes(id)) return null;
  const secrets = secretMatcherOf(root);
  const read = readEntity(root, kind, id, secrets);
  if (read === null) return null;
  const files = entriesOf(join(root, read.entity.folder))
    .filter(
      (entry) =>
        !entry.name.startsWith(".") &&
        entry.name !== lifeKindPlaces[kind].mainFile &&
        !secrets.matches(`${read.entity.folder}/${entry.name}`),
    )
    .slice(0, maxFiles)
    .map((entry): LifeEntityFile => ({
      name: entry.name,
      path: `${read.entity.folder}/${entry.name}`,
      kind: entry.folder ? "folder" : "file",
    }));
  return { ...read.entity, body: read.body, files };
}

/** The entity with `redact` applied to each text, also inside the nested fields. */
export function redactLifeEntity<Entity extends LifeEntity>(entity: Entity, redact: (text: string) => string): Entity {
  return redactValue(entity, redact) as Entity;
}

function redactValue(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redact));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redact(key), redactValue(item, redact)] as const),
    );
  return value;
}

function realRoot(vaultPath: string): string | null {
  try {
    return realpathSync(vaultPath);
  } catch {
    return null;
  }
}

function byId(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

/** True for one plain folder name, so an id from the address cannot climb out of its kind's folder. */
function isFolderName(id: string): boolean {
  return (
    id.length > 0 && id !== "." && id !== ".." && !id.includes("/") && !id.includes("\\") && !hasControlCharacter(id)
  );
}

/** The front matter keys that every note can have. The other keys go to `fields`. */
const commonKeys: ReadonlySet<string> = new Set(["summary", "aliases", "tags"]);

function readEntity(
  root: string,
  kind: LifeKind,
  id: string,
  secrets: SecretPaths,
): { readonly entity: LifeEntity; readonly body: string } | null {
  const folder = `${lifeKindPlaces[kind].folder}/${id}`;
  const path = `${folder}/${lifeKindPlaces[kind].mainFile}`;
  if (secrets.matches(path)) return null;
  const absolutePath = join(root, path);
  try {
    // A linked main file could point out of the vault.
    if (!lstatSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  // Null for an encrypted or binary file: it holds nothing to show.
  const read = readBounded(absolutePath, maxBodyBytes);
  if (read === null) return null;
  const warnings: string[] = [];
  const text = read.text.replace(/^\uFEFF/, "");
  const match = frontMatterPattern.exec(text);
  let body = text;
  let keys: Record<string, unknown> = {};
  if (match === null) {
    warnings.push(
      read.cut && text.startsWith("---")
        ? `The front matter is longer than ${String(maxBodyBytes / 1024)} KB, so Eva did not read it.`
        : "The file has no front matter.",
    );
  } else {
    body = text.slice(match[0].length);
    keys = parseKeys(match[1] ?? "", warnings);
    if (read.cut) warnings.push(`The file is longer than ${String(maxBodyBytes / 1024)} KB. The page shows its start.`);
  }
  const fields = Object.fromEntries(Object.entries(keys).filter(([key]) => !commonKeys.has(key)));
  return {
    entity: {
      kind,
      id,
      folder,
      path,
      title: titleHeading(body)?.title ?? readableName(id),
      summary: readSummary(keys["summary"], warnings),
      aliases: readList(keys["aliases"], "aliases", warnings),
      tags: readList(keys["tags"], "tags", warnings),
      fields,
      warnings,
    },
    body,
  };
}

function parseKeys(yaml: string, warnings: string[]): Record<string, unknown> {
  try {
    // The failsafe schema keeps each value as text, so a date or a chip number stays as written.
    const parsed: unknown = parseYaml(yaml, { schema: "failsafe" });
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
    // An empty front matter parses to null: it has no keys, and nothing is wrong.
    if (parsed === null) return {};
  } catch {
    // The warning below says it.
  }
  warnings.push("The front matter is not a valid list of keys.");
  return {};
}

function readSummary(value: unknown, warnings: string[]): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return oneLineSummary(value);
  warnings.push("summary must be one line of text.");
  return null;
}

/** A list of texts. One text alone counts as a list of one, as a person may write `tags: hobby`. */
function readList(value: unknown, key: string, warnings: string[]): string[] {
  if (value === undefined || value === "") return [];
  if (typeof value === "string") return [value];
  const items = Array.isArray(value) ? value : [value];
  const texts = items.filter((item): item is string => typeof item === "string" && item !== "");
  if (texts.length !== items.length) warnings.push(`${key} must be a list of texts.`);
  return texts;
}

/** "2026-05-15-phone-repair" reads "Phone repair". A name with spaces, such as a person's, stays. */
function readableName(id: string): string {
  if (id.includes(" ")) return id;
  const words = id
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (words === "") return id;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
