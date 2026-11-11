/**
 * The vault paths in a plain text, such as a note of a case or a value of its front matter (#911).
 * A path of a Life entity links to its page. Any other path under a root folder of the vault links
 * to the Files page. Each link comes from a parsed path, so a text never adds markup of its own.
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

/** The root folders of the vault template. A path under another folder is too likely to be code. */
const rootFolders = ["Life", "Projects", "Principles", "Methods", "Toolbox", "Library"];

const kindByFolder = new Map<string, LifeKind>(lifeKinds.map((kind) => [lifeKindPlaces[kind].folder, kind]));

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const kindFolders = lifeKinds.map((kind) => escaped(lifeKindPlaces[kind].folder.slice("Life/".length))).join("|");
const mainFiles = lifeKinds.map((kind) => escaped(lifeKindPlaces[kind].mainFile)).join("|");
/** A path ends at the end of the text, at a space, a comma, a semicolon, a bracket, a quote, or a dot or colon that ends a sentence. */
const end = String.raw`(?=$|[\s,;()<>"'\`]|[.:](?:\s|$))`;

/**
 * Three forms, in this order. A Life entity: its name holds spaces, so it ends only where a
 * sentence goes on. A file with an extension: its name can hold spaces too. Any other path: no spaces.
 */
const pathPattern = new RegExp(
  [
    String.raw`(?<![\w/.-])Life\/(?<kind>${kindFolders})\/(?<id>[^,;()\n/<>"'\`]*?[^\s,;()\n/<>"'\`])(?:\/(?:${mainFiles})|\/)?(?=\s*(?:$|[,;()\n<>"'\`])|\.(?:\s|$))`,
    String.raw`(?<![\w/.-])(?:${rootFolders.join("|")})\/(?:(?!\s(?:${rootFolders.join("|")})\/)[^,;()\n<>"'\`])*?\.[A-Za-z0-9]{1,8}${end}`,
    String.raw`(?<![\w/.-])(?:${rootFolders.join("|")})\/[^\s,;()<>"'\`]*[^\s,;()<>"'\`.:/]\/?${end}`,
  ].join("|"),
  "g",
);

/** The text with each vault path as a link. */
export function vaultTextParts(text: string): VaultTextPart[] {
  const parts: VaultTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pathPattern)) {
    const path = match[0];
    const { kind, id } = match.groups ?? {};
    const lifeKind = kind === undefined ? undefined : kindByFolder.get(`Life/${kind}`);
    const name = id?.trim() ?? "";
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push(
      lifeKind !== undefined && name !== ""
        ? { text: name, href: lifeAddressOf(lifeKind, name), title: path }
        : { text: path, href: fileAddressOf(path.replace(/\/$/, "")), title: path },
    );
    last = match.index + path.length;
  }
  if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last) });
  return parts;
}
