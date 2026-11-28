/**
 * Save and Remove of the pages of the chats (#1130). Save moves a page from a scratch folder, which
 * Eva empties after 7 days, to `.eva/pages/`, which the vault sync commits. It keeps the name, so
 * `resolveShownPage` leads each old `[[show:]]` line to the saved file with no rewrite.
 */
import { linkSync, lstatSync, mkdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { errorCode } from "../files/file-browser.ts";
import { readPage, resolveShownPage, savedPagesFolder, type ShownPage } from "./chat-pages.ts";

/**
 * Saves the page that a marker path shows, and answers the vault path of the saved file. A page
 * that is saved already, or kept in a notes folder, stays where it is. Save refuses each page that
 * Eva does not show, with the same reason: a page with a secret would never reach the sync.
 */
export function savePage(vaultPath: string, requested: string): string {
  const shown = readyPage(vaultPath, requested);
  if (shown.kept !== "temporary") return shown.relativePath;
  const name = basename(shown.path);
  const folder = pagesFolder(vaultPath);
  const target = join(folder, name);
  const bytes = readPage(shown.path);
  // The file can change between the check and the read, so the bytes that go in pass the checks again.
  if (bytes === null) throw new EvaError("file_not_found", `${requested} does not exist.`);
  if (containsSecretPattern(bytes.toString("utf8")))
    throw new EvaError("file_not_writable", `${requested} holds a secret, so Eva does not save it.`);
  // A link of a whole file is one step: a crash leaves no half page that would win over the scratch copy.
  const temporary = join(folder, `.${name}.${String(process.pid)}.${String(Date.now())}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    linkSync(temporary, target);
  } catch (error) {
    if (errorCode(error) === "EEXIST")
      throw new EvaError(
        "file_not_writable",
        `A saved page named ${name} exists already, so Eva keeps both as they are.`,
      );
    throw new EvaError("file_not_writable", "Eva has no permission to save this page.");
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    unlinkSync(shown.path);
  } catch {
    // The saved file wins over a scratch copy that stays, and the weekly clean removes the copy.
  }
  return `${savedPagesFolder}/${name}`;
}

/**
 * Deletes a saved page in `.eva/pages/`, and answers its vault path. Every old marker of the page
 * then finds no file. A scratch page goes after 7 days, and a note goes on the Files page.
 */
export function removeSavedPage(vaultPath: string, requested: string): string {
  const shown = readyPage(vaultPath, requested);
  if (shown.kept !== "saved")
    throw new EvaError("file_not_writable", `${requested} is not a saved page, so Eva does not remove it here.`);
  try {
    // The real path of the file, which `resolveShownPage` checked. A link put there meanwhile goes, never its target.
    if (lstatSync(shown.path).isFile()) unlinkSync(shown.path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new EvaError("file_not_found", `${requested} does not exist.`);
    throw new EvaError("file_not_writable", "Eva has no permission to remove this page.");
  }
  return shown.relativePath;
}

function readyPage(vaultPath: string, requested: string): Extract<ShownPage, { readonly state: "ready" }> {
  const shown = resolveShownPage(vaultPath, requested);
  if (shown.state === "gone") throw new EvaError("file_not_found", shown.reason);
  if (shown.state !== "ready") throw new EvaError("file_not_writable", shown.reason);
  return shown;
}

/** The real `.eva/pages/` folder of the vault. A link put in its place could lead a page out of Eva's folder. */
function pagesFolder(vaultPath: string): string {
  const root = realpathSync(vaultPath);
  const wanted = join(root, ...savedPagesFolder.split("/"));
  try {
    mkdirSync(wanted, { recursive: true });
    if (realpathSync(wanted) === wanted) return wanted;
  } catch {
    // A file in the place of the folder: the refusal below says it.
  }
  throw new EvaError("file_not_writable", `${savedPagesFolder} is not a plain folder, so Eva does not save the page.`);
}
