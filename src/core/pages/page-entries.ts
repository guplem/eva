/**
 * The one rule that keeps the pages of the chats (#1130) away from the person's other files. A page
 * file on the scratch side or the saved side counts only when Eva reaches it through plain entries:
 * from the vault root, each level a real folder and the last a regular file, with no link anywhere.
 * Save and Remove delete only an entry that passed this check, at its literal path in a page folder.
 * So a link that an agent made, at any level, can never lead a page action to a note.
 */
import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";

/** The page folders, from the vault root, as literal parts: the scratch folders and the saved pages. */
const pageFolders: readonly (readonly string[])[] = [[".eva", "scratch"], ["Scratch"], [".eva", "pages"]];

/**
 * The absolute path of a page file at `path`, a path from the real vault root with `/`, or null.
 * Each folder from the root must be a real folder, not a link. With `file`, the last entry must be a
 * regular file. With `entry`, it may also be a link, which Remove takes away without following it.
 */
export function plainPageFile(root: string, path: string, last: "file" | "entry" = "file"): string | null {
  const parts = path.split("/");
  for (let level = 1; level <= parts.length; level += 1) {
    let stats;
    try {
      stats = lstatSync(join(root, ...parts.slice(0, level)));
    } catch {
      return null;
    }
    if (level < parts.length) {
      if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
    } else if (!(stats.isFile() || (last === "entry" && stats.isSymbolicLink()))) return null;
  }
  return join(root, ...parts);
}

/**
 * Deletes one page entry, at its literal path in a page folder, after the plain check. It refuses
 * every other path, so no caller can delete a note through it, now or later.
 */
export function deletePageEntry(root: string, path: string): void {
  const parts = path.split("/");
  const folder = pageFolders.find((candidate) => candidate.every((part, index) => parts[index] === part));
  const inside = folder !== undefined && parts.length > folder.length;
  if (!inside || parts.some((part) => part === "" || part === "." || part === ".."))
    throw new EvaError("file_not_writable", `${path} is not in a page folder, so Eva does not delete it.`);
  const entry = plainPageFile(root, path, "entry");
  if (entry === null)
    throw new EvaError("file_not_writable", `${path} is not a plain page, so Eva does not delete it.`);
  // `rmSync` removes a link itself, never the file that it names.
  rmSync(entry);
}
