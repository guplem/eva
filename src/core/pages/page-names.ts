/**
 * The name of a page of a chat (#1130). A page has two places: its scratch file, which Eva
 * empties after 7 days, and its saved file in `.eva/pages/`, which Save writes. Both share one
 * name: the path under the scratch folder. The name comes from the real path of the file, after
 * links and `..` parts resolve, never from the text of the marker. So two markers that lead to one
 * file give one name, and a marker that leads out of Eva's folders gives none. The two places of a
 * name are literal paths: `page-entries.ts` decides whether Eva may use them. This file only reads.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { isInside } from "../../shared/path-area.ts";

/** Where Save puts a page, from the vault root. The vault sync commits it, and the weekly clean never enters it. */
export const savedPagesFolder = ".eva/pages";
/** The scratch folders, from the vault root: Eva's own, and the old one at the root (`scratch-folders.ts`). */
const scratchFolders = [".eva/scratch", "Scratch"] as const;

export interface PageName {
  /** `scratch` when the marker leads into a scratch folder, `saved` when it leads into `.eva/pages/`. */
  readonly kind: "scratch" | "saved";
  /** The path under the scratch folder, with `/`, in the case on disk. */
  readonly name: string;
  /** The scratch file of the name, from the vault root, which may not exist. */
  readonly scratch: string;
  /** The saved file of the name, from the vault root, which may not exist. */
  readonly saved: string;
}

/**
 * The name of the page that a marker path leads to, or null for a file outside Eva's two folders,
 * such as a note, and for a path that leaves the vault or that no file system could open.
 */
export function pageNameOf(vaultPath: string, requested: string): PageName | null {
  const root = realRoot(vaultPath);
  if (root === null) return null;
  const place = placeOf(root, requested);
  if (place === null) return null;
  for (const folder of scratchFolders) {
    const name = nameUnder(placeOf(root, folder), place);
    // The literal path in the folder, never the place that a link led to: `page-entries.ts` checks it.
    if (name !== null)
      return { kind: "scratch", name, scratch: `${folder}/${name}`, saved: `${savedPagesFolder}/${name}` };
  }
  const name = nameUnder(placeOf(root, savedPagesFolder), place);
  if (name === null) return null;
  return { kind: "saved", name, scratch: `${scratchFolders[0]}/${name}`, saved: `${savedPagesFolder}/${name}` };
}

/**
 * The real path that a path from the vault root leads to, inside the vault, or null. It starts
 * from `join(root, requested)`, as `resolveSendableFile` does, so the name follows the file that
 * Eva shows. A file that does not exist keeps the real path of its nearest folder that exists, with
 * the rest of its parts.
 */
function placeOf(root: string, requested: string): string | null {
  // Windows reads a colon in a name as a file stream, which a name check cannot see through.
  if (isAbsolute(requested) || (process.platform === "win32" && requested.includes(":"))) return null;
  let current = join(root, requested);
  if (!isInside(root, current)) return null;
  const rest: string[] = [];
  for (;;) {
    try {
      const place = join(realpathSync.native(current), ...rest);
      return isInside(root, place) ? place : null;
    } catch {
      // The root exists, so the walk ends there at the latest.
      if (relative(root, current) === "") return null;
      rest.unshift(windowsName(basename(current)));
      current = dirname(current);
    }
  }
}

/** Windows drops the trailing dots and spaces of a name, so `scratch.` is `scratch` there. */
function windowsName(part: string): string {
  return process.platform === "win32" ? part.replace(/[. ]+$/, "") : part;
}

/**
 * The entry at the marker's own place: its folders resolve, and its last part stays as it is, also
 * when it is a link. Save checks it, so it never removes a file through a link.
 */
export function entryOf(root: string, requested: string): string | null {
  const lexical = join(root, requested);
  if (!isInside(root, lexical) || relative(root, lexical) === "") return null;
  const folder = placeOf(root, relative(root, dirname(lexical)));
  return folder === null ? null : join(folder, windowsName(basename(lexical)));
}

/**
 * The saved path of the entry at the marker's own place, when that entry is inside `.eva/pages/`,
 * or null. A link there names another file, but it is the entry that the chat shows, so Remove can
 * take it away. The Files page leaves `.eva/` alone.
 */
export function ownSavedEntryOf(vaultPath: string, requested: string): string | null {
  const root = realRoot(vaultPath);
  if (root === null) return null;
  const entry = entryOf(root, requested);
  const name = entry === null ? null : nameUnder(placeOf(root, savedPagesFolder), entry);
  return name === null ? null : `${savedPagesFolder}/${name}`;
}

/** The path of `place` under `folder`, with `/`, or null when it is not inside it. `relative` ignores case on Windows. */
function nameUnder(folder: string | null, place: string): string | null {
  if (folder === null) return null;
  const between = relative(folder, place);
  if (between === "" || isAbsolute(between) || between === ".." || between.startsWith(`..${sep}`)) return null;
  return between.split(sep).join("/");
}

/** The real vault root, in the case on disk, or null. `.native` gives the case on disk on Windows too. */
export function realRoot(vaultPath: string): string | null {
  try {
    return realpathSync.native(vaultPath);
  } catch {
    return null;
  }
}
