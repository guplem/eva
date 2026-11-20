/**
 * The backlinks of the file explorer: the vault notes that link to one file (#992). A link is a
 * wiki link, such as `[[Note|alias]]`, or a Markdown link, such as `[text](../Note.md)`. The walk
 * keeps the rules of the search: no symbolic link followed, no git data, no clone, no secrets file.
 */
import { existsSync, realpathSync } from "node:fs";
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
/**
 * The link of `[text](link "title")`, with or without angle brackets. A link can hold one level of
 * parentheses, such as `Note%20(old).md`, and a title can take any of the three quote forms.
 */
const markdownLink = /\]\(\s*(<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
/** A link with a scheme, such as `https:` or `mailto:`, leaves the vault. */
const scheme = /^[a-z][a-z0-9+.-]*:/i;
/** A line that opens or closes a code block. Obsidian makes no link inside code. */
const fence = /^\s*(?:```|~~~)/;
const inlineCode = /`[^`\n]*`/g;

/** Where a note is, and what it looks for. `wanted` is lower case and in Unicode form NFC. */
interface Place {
  readonly root: string;
  readonly folder: string;
  readonly wanted: string;
}

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
      const place = { root, folder: posix.dirname(path), wanted: comparable(wanted) };
      const found = linkIn(join(root, path), path, entry.name, place, budget, redact);
      if (found === null) continue;
      links.push(found);
      if (links.length >= maxSearchMatches) return { links, complete: false };
    }
  }
  return { links, complete: true };
}

/** A macOS name can come in the other Unicode form, so `é` compares equal in both forms. */
function comparable(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

function linkIn(
  file: string,
  path: string,
  name: string,
  place: Place,
  budget: { bytes: number },
  redact: (text: string) => string,
): Backlink | null {
  const lines = plainLinesOf(file, budget);
  if (lines === null) return null;
  let inCode = false;
  for (const [index, line] of lines.entries()) {
    if (fence.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const link = firstLinkTo(
      line.replace(inlineCode, (code) => " ".repeat(code.length)),
      place,
    );
    if (link === null) continue;
    const shown = redact(line);
    const at = Math.max(0, shown.indexOf(link));
    return { path, name, line: { number: index + 1, text: cutAround(shown, at, link.length) } };
  }
  return null;
}

/** The text of the first link in `line` that points to the wanted file, or null. */
function firstLinkTo(line: string, place: Place): string | null {
  for (const match of line.matchAll(wikiLink)) if (wikiPointsTo(match[1] ?? "", place)) return match[0];
  for (const match of line.matchAll(markdownLink)) if (markdownPointsTo(match[1] ?? "", place)) return match[0];
  return null;
}

function wikiPointsTo(inner: string, { folder, wanted }: Place): boolean {
  // The alias follows `|`, or `\|` in a table. A heading follows `#`, and a block follows `^`.
  // `[[#Heading]]` points into the note itself.
  const name = comparable((inner.split(/\\?\|/)[0] ?? "").split(/[#^]/)[0]?.trim().replace(/^\/+/, "") ?? "");
  if (name === "") return false;
  // Obsidian writes a relative path when its link format asks for one.
  const relative = name.startsWith("./") || name.startsWith("../");
  const path = relative ? comparable(posix.normalize(posix.join(folder, name))) : name;
  return [path, `${path}.md`].some(
    (candidate) => wanted === candidate || (!relative && wanted.endsWith(`/${candidate}`)),
  );
}

function markdownPointsTo(raw: string, { root, folder, wanted }: Place): boolean {
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
  const fromRoot = decoded.startsWith("/");
  const resolved = fromRoot ? posix.normalize(decoded.slice(1)) : posix.normalize(posix.join(folder, decoded));
  if (comparable(resolved) === wanted) return true;
  // Obsidian's shortest path names a file by its name alone when no file beside the note has it.
  const short = comparable(decoded);
  if (fromRoot || short.startsWith("./") || short.startsWith("../") || existsSync(join(root, resolved))) return false;
  return wanted === short || wanted.endsWith(`/${short}`);
}
