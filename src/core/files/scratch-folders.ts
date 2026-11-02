/**
 * The scratch folders hold the files of the chats: a file made only to send, such as a PDF, and each
 * file that the person sends. Git never saves them, and Eva removes each file after a week.
 *
 * Eva writes only in `.eva/scratch/`, because what is not the vault lives in Eva. Before #767 she
 * wrote in `Scratch/` at the vault root, and an old vault map still names it, so an agent can still
 * write there. So Eva keeps the old folder protected while it exists, and removes it once it is
 * empty. Only an old vault's `.gitignore` lists `Scratch/`, and the sync and the clean act on the
 * old folder only then. Drop the old folder from these rules only when no vault map names it any
 * more (#773).
 *
 * The web page uses these rules too, so this file reads no disk.
 */

/** Where Eva writes the files of the chats, from the vault root. */
export const scratchFolder = ".eva/scratch";

/**
 * True for a path from the vault root in a scratch folder, or for the folder itself: `.eva/scratch`
 * or the old `Scratch`. Windows and macOS ignore the case, so the check ignores it too.
 */
export function isScratchPath(relativePath: string): boolean {
  return scratchFolderOf(relativePath) !== null;
}

/** The scratch folder of a path from the vault root, in the path's own case, or null. */
export function scratchFolderOf(relativePath: string): string | null {
  const parts = segments(relativePath);
  const lower = parts.map((part) => part.toLowerCase());
  if (lower[0] === "scratch") return parts[0] ?? null;
  if (lower[0] === ".eva" && lower[1] === "scratch") return parts.slice(0, 2).join("/");
  return null;
}

/**
 * The segments of a path as a file system reads it: `\` is `/`, empty and `.` segments go, `..`
 * goes up, and Windows drops the trailing dots and spaces of a name. A path that leaves the vault
 * keeps its `..`, so it never counts.
 */
function segments(relativePath: string): string[] {
  const kept: string[] = [];
  for (const part of relativePath.split(/[/\\]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (kept.length === 0 || kept.at(-1) === "..") kept.push("..");
      else kept.pop();
      continue;
    }
    const name = part.replace(/[. ]+$/, "");
    if (name !== "") kept.push(name);
  }
  return kept;
}
