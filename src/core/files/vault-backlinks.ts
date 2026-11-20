/**
 * The backlinks of the file explorer: the vault notes that link to one file (#992). A link is a
 * wiki link, such as `[[Note|alias]]`, or a Markdown link, such as `[text](../Note.md)`. The walk
 * keeps the rules of the search: no link followed, no git data, no clone, no secrets file.
 */
import { realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { secretMatcherOf } from "./secret-paths.ts";
import { isClonePath } from "./vault-files.ts";
import {
  cutAround,
  maxReadBytes,
  maxSearchMatches,
  maxVisitedEntries,
  plainLinesOf,
  sortedEntries,
} from "./vault-search.ts";

export interface Backlink {
  /** The forward-slash path of the linking note from the vault root. */
  readonly path: string;
  readonly name: string;
  /** The first line of the note that holds a link to the file, after the redactor ran. */
  readonly line: { readonly number: number; readonly text: string };
}

export interface BacklinksResult {
  readonly links: readonly Backlink[];
  /** False when the walk stopped at a limit before it saw the whole vault. */
  readonly complete: boolean;
}

/** Links live in notes. Any other file is too likely to hold code, where `[[x]]` means something else. */
const noteExtension = /\.(?:md|markdown)$/i;
const wikiLink = /\[\[([^[\]\n]+)\]\]/g;
/** The link of `[text](link "title")`, with or without angle brackets. */
const markdownLink = /\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;
/** A link with a scheme, such as `https:` or `mailto:`, leaves the vault. */
const scheme = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The notes that link to `target`, a forward-slash path from the vault root. Names compare in any
 * case, as in Obsidian: `[[Note]]` links to each `Note.md`, and `[[Folder/Note]]` to each
 * `Note.md` in a folder `Folder`.
 */
export function findBacklinks(vaultPath: string, target: string, redact: (text: string) => string): BacklinksResult {
  const wanted = posix.normalize(target.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (wanted === "." || wanted === ".." || wanted.startsWith("../")) return { links: [], complete: true };
  const root = realpathSync(vaultPath);
  const secrets = secretMatcherOf(root);
  const links: Backlink[] = [];
  const budget = { bytes: maxReadBytes };
  let entries = maxVisitedEntries;
  const queue: string[] = [""];
  for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
    for (const entry of sortedEntries(join(root, folder))) {
      entries -= 1;
      if (entries < 0) return { links, complete: false };
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "folder") {
        if (!isClonePath(path)) queue.push(path);
        continue;
      }
      if (!noteExtension.test(entry.name) || path === wanted || secrets.matches(path)) continue;
      const found = linkIn(join(root, path), path, entry.name, wanted.toLowerCase(), budget, redact);
      if (found === null) continue;
      links.push(found);
      if (links.length >= maxSearchMatches) return { links, complete: false };
    }
  }
  return { links, complete: true };
}

function linkIn(
  file: string,
  path: string,
  name: string,
  wanted: string,
  budget: { bytes: number },
  redact: (text: string) => string,
): Backlink | null {
  const lines = plainLinesOf(file, budget);
  if (lines === null) return null;
  const folder = posix.dirname(path);
  for (const [index, line] of lines.entries()) {
    const link = firstLinkTo(line, folder, wanted);
    if (link === null) continue;
    const shown = redact(line);
    const at = Math.max(0, shown.indexOf(link));
    return { path, name, line: { number: index + 1, text: cutAround(shown, at, link.length) } };
  }
  return null;
}

/** The text of the first link in `line` that points to `wanted`, a lower-case path, or null. */
function firstLinkTo(line: string, folder: string, wanted: string): string | null {
  for (const match of line.matchAll(wikiLink)) if (wikiPointsTo(match[1] ?? "", wanted)) return match[0];
  for (const match of line.matchAll(markdownLink))
    if (markdownPointsTo(match[1] ?? "", folder, wanted)) return match[0];
  return null;
}

function wikiPointsTo(inner: string, wanted: string): boolean {
  // The alias follows `|`, and a heading or a block follows `#`. `[[#Heading]]` points into the note itself.
  const name = (inner.split("|")[0] ?? "").split("#")[0]?.trim().replace(/^\/+/, "").toLowerCase() ?? "";
  if (name === "") return false;
  return [name, `${name}.md`].some((candidate) => wanted === candidate || wanted.endsWith(`/${candidate}`));
}

function markdownPointsTo(raw: string, folder: string, wanted: string): boolean {
  const link = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  if (scheme.test(link)) return false;
  const bare = link.split(/[#?]/)[0] ?? "";
  if (bare === "") return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    decoded = bare;
  }
  const resolved = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(folder, decoded));
  return resolved.toLowerCase() === wanted;
}
