/**
 * The scratch folders hold the files of the chats: a file made only to send, such as a PDF, and each
 * file that the person sends. Git never saves them, and Eva removes each file after a week.
 *
 * Eva writes only in `.eva/scratch/`, because what is not the vault lives in Eva. Before #767 she
 * wrote in `Scratch/` at the vault root, and an old vault map still names it, so an agent can still
 * write there. So Eva keeps the old folder protected while it exists, and removes it once it is
 * empty. Drop the old folder from these rules only when no vault map names it any more (#773).
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
  const parts = relativePath.split(/[/\\]/).map((part) => part.toLowerCase());
  return parts[0] === "scratch" || (parts[0] === ".eva" && parts[1] === "scratch");
}
