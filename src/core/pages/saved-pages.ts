/**
 * Save and Remove of the pages of the chats (#1130). Save moves a page from a scratch folder, which
 * Eva empties after 7 days, to `.eva/pages/`, which the vault sync commits. It keeps the name that
 * `page-names.ts` gives, so `resolveShownPage` leads each old `[[show:]]` line to the saved file
 * with no rewrite. Neither action follows a link, and a refusal changes nothing on disk.
 */
import { lstatSync, mkdirSync, realpathSync, rmSync, type Stats } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { errorCode } from "../files/file-browser.ts";
import { pageExtensions, readPage, resolveShownPage } from "./chat-pages.ts";
import { entryOf, ownSavedEntryOf, pageNameOf } from "./page-names.ts";

/**
 * Saves the page that a marker path shows, and answers the vault path of the saved file. A page
 * that is saved already, or kept in a notes folder, stays where it is. A scratch page replaces an
 * older saved page of its name: the scratch file is the newest version, and the vault history keeps
 * the old one. Save refuses each page that Eva does not show, with the same reason: a page with a
 * secret would never reach the sync.
 */
export function savePage(vaultPath: string, requested: string): string {
  const shown = resolveShownPage(vaultPath, requested);
  if (shown.state === "gone") throw new EvaError("file_not_found", shown.reason);
  if (shown.state !== "ready") throw new EvaError("file_not_writable", shown.reason);
  // Only a marker with the name of a page shows a temporary page, so a page with no name is kept already.
  const page = pageNameOf(vaultPath, requested);
  if (shown.kept !== "temporary" || page === null) return shown.relativePath;
  const root = realpathSync(vaultPath);
  // Save removes the scratch file afterwards. Through a link it would remove another page, which the person never saved.
  if (isLink(entryOf(root, requested)))
    throw new EvaError(
      "file_not_writable",
      `${requested} is a link, so Eva does not save it. Ask Eva to show the page itself.`,
    );
  const target = plainFolders(root, page.saved, true);
  const existing = entryAt(target);
  if (existing !== null && !(existing.isFile() && pageExtensions.has(extname(target).toLowerCase())))
    throw new EvaError("file_not_writable", `${page.saved} is not a page, so Eva does not write over it.`);
  const bytes = readPage(shown.path);
  // The file can change between the check and the read, so the bytes that go in pass the checks again.
  if (bytes === null || containsSecretPattern(bytes.toString("utf8")))
    throw new EvaError("file_not_writable", `${requested} changed while Eva saved it. Try again.`);
  try {
    // A rename of a whole file: a crash leaves no half page.
    writeFileAtomic(target, bytes);
  } catch (error) {
    throw new EvaError("file_not_writable", `Eva could not write ${page.saved}: ${writeProblem(error)}.`);
  }
  // The saved file answers the marker once the scratch file is gone. It is no link, as the check above showed.
  rmSync(shown.path, { force: true });
  return page.saved;
}

/**
 * Deletes a saved page in `.eva/pages/`, and answers its vault path. Every old marker of the page
 * then finds no file. It works whatever the page holds, such as a secret or more than 2 MB, so the
 * person can always remove a page that Eva does not show any more. A scratch page goes after 7
 * days, and a note goes on the Files page.
 */
export function removeSavedPage(vaultPath: string, requested: string): string {
  const saved = ownSavedEntryOf(vaultPath, requested) ?? pageNameOf(vaultPath, requested)?.saved ?? null;
  if (saved === null)
    throw new EvaError("file_not_writable", `${requested} is not a saved page, so Eva does not remove it here.`);
  const target = plainFolders(realpathSync(vaultPath), saved, false);
  const existing = entryAt(target);
  if (existing === null) throw new EvaError("file_not_found", `${saved} does not exist.`);
  if (existing.isDirectory()) throw new EvaError("file_not_writable", `${saved} is a folder, not a page.`);
  // `rmSync` removes a link itself, never the file that it names.
  rmSync(target);
  return saved;
}

/**
 * The path of a saved page under the real vault root. Each folder from the root to the page must be
 * a plain folder: a link in its place could lead a write or a delete out of Eva's folder. The check
 * reads every level that exists before Eva makes one, so a refusal makes nothing. `make` makes the
 * missing folders; without it, a missing folder means that the page does not exist.
 */
function plainFolders(root: string, saved: string, make: boolean): string {
  const parts = saved.split("/");
  const name = parts.pop() ?? "";
  const levels = parts.map((_part, index) => join(root, ...parts.slice(0, index + 1)));
  const missing: string[] = [];
  for (const level of levels) {
    const entry = missing.length > 0 ? null : entryAt(level);
    if (entry === null) {
      missing.push(level);
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new EvaError(
        "file_not_writable",
        `${relative(root, level)} is not a plain folder, so Eva does not touch the page.`,
      );
  }
  if (missing.length > 0 && !make) throw new EvaError("file_not_found", `${saved} does not exist.`);
  try {
    for (const level of missing) mkdirSync(level);
  } catch (error) {
    throw new EvaError("file_not_writable", `Eva could not make ${dirname(saved)}: ${writeProblem(error)}.`);
  }
  return join(root, ...parts, name);
}

function isLink(path: string | null): boolean {
  return path !== null && entryAt(path)?.isSymbolicLink() === true;
}

/** The entry at a path, not followed when it is a link, or null when nothing is there. */
function entryAt(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** The cause of a failed write, so the person knows what to fix: a full disk (`ENOSPC`) is not a missing permission. */
const writeCauses: Readonly<Record<string, string>> = {
  EACCES: "Eva has no permission to write there",
  EPERM: "Eva has no permission to write there",
  ENOSPC: "the disk is full",
  EROFS: "the disk takes no writes",
};

export function writeProblem(error: unknown): string {
  const code = errorCode(error) ?? "unknown";
  return writeCauses[code] ?? `the file system answered ${code}`;
}
