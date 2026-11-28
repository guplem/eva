/**
 * Save and Remove of the pages of the chats (#1130). Save moves a page from a scratch folder, which
 * Eva empties after 7 days, to `.eva/pages/`, which the vault sync commits. It keeps the name, the
 * whole path under the scratch folder, so `resolveShownPage` leads each old `[[show:]]` line to the
 * saved file with no rewrite.
 */
import { lstatSync, mkdirSync, realpathSync, rmSync, type Stats } from "node:fs";
import { extname, join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { errorCode } from "../files/file-browser.ts";
import { readPage, resolveShownPage, savedPagesFolder, savedPathOf } from "./chat-pages.ts";

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
  if (shown.kept !== "temporary") return shown.relativePath;
  // A temporary page has a scratch name, so it has a saved path.
  const saved = savedPathOf(requested) ?? `${savedPagesFolder}/${shown.relativePath}`;
  const target = savedFile(vaultPath, saved, true);
  const existing = entryAt(target);
  if (existing !== null && !(existing.isFile() && isPageName(target)))
    throw new EvaError("file_not_writable", `${saved} is not a page, so Eva does not write over it.`);
  const bytes = readPage(shown.path);
  // The file can change between the check and the read, so the bytes that go in pass the checks again.
  if (bytes === null || containsSecretPattern(bytes.toString("utf8")))
    throw new EvaError("file_not_writable", `${requested} changed while Eva saved it. Try again.`);
  try {
    // A rename of a whole file: a crash leaves no half page.
    writeFileAtomic(target, bytes);
  } catch (error) {
    throw new EvaError("file_not_writable", `Eva could not write ${saved}: ${writeProblem(error)}.`);
  }
  // The saved file answers the marker once the scratch copy is gone.
  rmSync(shown.path, { force: true });
  return saved;
}

/**
 * Deletes a saved page in `.eva/pages/`, and answers its vault path. Every old marker of the page
 * then finds no file. It works whatever the page holds, such as a secret or more than 2 MB, so the
 * person can always remove a page that Eva does not show any more. A scratch page goes after 7
 * days, and a note goes on the Files page.
 */
export function removeSavedPage(vaultPath: string, requested: string): string {
  const saved = savedPathOf(requested);
  if (saved === null)
    throw new EvaError("file_not_writable", `${requested} is not a saved page, so Eva does not remove it here.`);
  const target = savedFile(vaultPath, saved, false);
  const existing = entryAt(target);
  if (existing === null) throw new EvaError("file_not_found", `${saved} does not exist.`);
  if (existing.isDirectory()) throw new EvaError("file_not_writable", `${saved} is a folder, not a page.`);
  // `rmSync` removes a link itself, never the file that it names.
  rmSync(target);
  return saved;
}

/**
 * The real path of a saved page. Each folder from the vault to the page must be a plain folder: a
 * link in its place could lead a write or a delete out of Eva's folder. `make` makes the folders.
 */
function savedFile(vaultPath: string, saved: string, make: boolean): string {
  const root = realpathSync(vaultPath);
  const parts = saved.split("/");
  const name = parts.pop() ?? "";
  const folder = join(root, ...parts);
  try {
    if (make) mkdirSync(folder, { recursive: true });
    if (realpathSync(folder) === folder) return join(folder, name);
  } catch (error) {
    if (!make && errorCode(error) === "ENOENT") throw new EvaError("file_not_found", `${saved} does not exist.`);
  }
  throw new EvaError("file_not_writable", `${parts.join("/")} is not a plain folder, so Eva does not touch the page.`);
}

/** The entry at a path, not followed when it is a link, or null when nothing is there. */
function entryAt(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function isPageName(path: string): boolean {
  return [".html", ".htm"].includes(extname(path).toLowerCase());
}

/** The cause of a failed write, so the person knows what to fix: a full disk (`ENOSPC`) is not a missing permission. */
const writeCauses: Readonly<Record<string, string>> = {
  EACCES: "Eva has no permission to write there",
  EPERM: "Eva has no permission to write there",
  ENOSPC: "the disk is full",
  EROFS: "the disk takes no writes",
};

function writeProblem(error: unknown): string {
  const code = errorCode(error) ?? "unknown";
  return writeCauses[code] ?? `the file system answered ${code}`;
}
