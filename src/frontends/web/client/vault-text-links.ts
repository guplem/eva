/**
 * The vault paths in a plain text, such as a note of a case or a value of its front matter (#911).
 * A path of a Life entity links to its page, but only when it names a known entity: a name holds
 * spaces, so only the real names tell where it ends. Any other path under a root folder links to
 * the Files page when its end is sure. Each link comes from a parsed path, never from markup.
 */
import { lifeKindPlaces, lifeKinds, type LifeKind } from "../../../shared/life-kinds.ts";
import { fileAddressOf } from "./file-paths.ts";
import { lifeAddressOf } from "./life-routes.ts";

/** A piece of a text. A piece with `href` names a vault path, kept in `title`. */
export interface VaultTextPart {
  readonly text: string;
  readonly href?: string;
  readonly title?: string;
}

/** The ids of the entities of each kind that the page knows. A kind that is missing links nothing. */
export type KnownLifeIds = Partial<Readonly<Record<LifeKind, readonly string[]>>>;

/** The root folders of the vault template. A path under another folder is too likely to be code. */
const rootFolders = ["Life", "Projects", "Principles", "Methods", "Toolbox", "Library"];

const kindByFolder = new Map<string, LifeKind>(
  lifeKinds.map((kind) => [lifeKindPlaces[kind].folder.slice("Life/".length), kind]),
);

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const kindFolders = [...kindByFolder.keys()].map(escaped).join("|");
const roots = rootFolders.join("|");

/** The start of a vault path: a root folder after a space or a mark, never inside a word or another path. */
const rootPattern = new RegExp(String.raw`(?<![\w/.-])(?:${roots})\/`, "g");
/** The folder of a Life kind, right after `Life/`. */
const kindPattern = new RegExp(String.raw`^Life\/(${kindFolders})\/`);
/** A path ends at the end of the text, at a space, a mark, or a dot or colon that ends a sentence. */
const end = String.raw`(?=$|[\s,;()<>"'\`]|[.:](?:\s|$))`;
/** A path whose end is sure: a file name with an extension, which can hold spaces, or a path with no space. */
const filePattern = new RegExp(
  String.raw`^(?:(?:${roots})\/(?:(?!\s(?:${roots})\/)[^,;()\n<>"'\`])*?\.[A-Za-z0-9]{1,8}${end}|(?:${roots})\/[^\s,;()<>"'\`]*[^\s,;()<>"'\`.:/]\/?${end})`,
);
/** A letter, a digit or a joining mark: an id that a word goes on after is not the id. */
const wordGoesOn = /^[\p{L}\p{N}_-]/u;

/** The longest known id that the text starts with and that ends where a word ends. */
function knownIdAt(rest: string, ids: readonly string[]): string | null {
  let found: string | null = null;
  for (const id of ids) {
    if (id === "" || !rest.startsWith(id) || wordGoesOn.test(rest.slice(id.length))) continue;
    if (found === null || id.length > found.length) found = id;
  }
  return found;
}

/** The link that starts at the front of `text`, and its length, or null. */
function linkAt(text: string, known: KnownLifeIds): { readonly part: VaultTextPart; readonly length: number } | null {
  const file = (): { readonly part: VaultTextPart; readonly length: number } | null => {
    const path = filePattern.exec(text)?.[0];
    if (path === undefined) return null;
    return { part: { text: path, href: fileAddressOf(path.replace(/\/$/, "")), title: path }, length: path.length };
  };
  const folder = kindPattern.exec(text);
  const kind = kindByFolder.get(folder?.[1] ?? "");
  if (folder === null || kind === undefined) return file();
  const rest = text.slice(folder[0].length);
  const id = knownIdAt(rest, known[kind] ?? []);
  if (id === null) return null;
  const after = rest.slice(id.length);
  const mainFile = `/${lifeKindPlaces[kind].mainFile}`;
  // Another file beside the main file opens in Files.
  if (after.startsWith("/") && !after.startsWith(mainFile)) return file();
  const length = folder[0].length + id.length + (after.startsWith(mainFile) ? mainFile.length : 0);
  const path = text.slice(0, length);
  return { part: { text: id, href: lifeAddressOf(kind, id), title: path }, length };
}

/** The text with each vault path whose end is sure as a link. */
export function vaultTextParts(text: string, known: KnownLifeIds = {}): VaultTextPart[] {
  const parts: VaultTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(rootPattern)) {
    // A match inside a path that is already a link adds nothing.
    if (match.index < last) continue;
    const link = linkAt(text.slice(match.index), known);
    if (link === null) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push(link.part);
    last = match.index + link.length;
  }
  if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last) });
  return parts;
}

/** Each Life kind that the text names a path of, in the order of `lifeKinds`, so a page loads only their ids. */
export function lifeKindsNamed(text: string): LifeKind[] {
  const named = new Set(
    [...text.matchAll(new RegExp(String.raw`Life\/(${kindFolders})\/`, "g"))].map((match) =>
      kindByFolder.get(match[1] ?? ""),
    ),
  );
  return lifeKinds.filter((kind) => named.has(kind));
}

/**
 * The text with each Life path as the name of its folder, for a card: a card holds no link, and it
 * knows no ids, so a path ends where the value or the sentence ends, as a relation or an owner does.
 */
export function withEntityNames(text: string): string {
  return text.replace(
    new RegExp(
      String.raw`Life\/(?:${kindFolders})\/([^,;()\n/]+?)(?:\/[^,;()\n/]+\.md|\/)?(?=$|[,;()\n]|\.(?:\s|$))`,
      "g",
    ),
    (_path, id: string) => id.trim(),
  );
}
