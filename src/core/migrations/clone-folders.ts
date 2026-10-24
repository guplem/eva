/**
 * A clone held one repository, in `Projects/<id>/repos/<repo>-<n>/`. Now a clone is a folder with
 * every repository of the project inside it: `repos/clone-<n>/<repo>/` (#521). The owner chose to
 * delete each old clone, with no exception. The chats that worked in one go too. Work that only an
 * old clone holds is lost. Clones are git-ignored, so each computer deletes its own.
 *
 * This migration is frozen: it works on raw JSON and on the folders as they were on 2026-10-24.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readJsonTolerant } from "../../shared/files.ts";
import type { Migration } from "./migration-runner.ts";

/** The old clone folder name. A new clone, `clone-<n>`, has no git folder of its own. */
const oldCloneName = /^.+-\d+$/;
const newCloneName = /^clone-\d+$/;

type JsonObject = Record<string, unknown>;

export const deleteOldCloneFolders: Migration = {
  id: "2026-10-24-delete-old-clone-folders",
  store: "machine",
  run: (context) => {
    const vaultPath = context.vaultPath;
    // A vault that is not cloned yet has no clones either, but it can arrive later with them.
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    const deleted = new Set<string>();
    for (const project of namesIn(join(vaultPath, "Projects"))) {
      const reposFolder = join(vaultPath, "Projects", project, "repos");
      for (const name of namesIn(reposFolder)) {
        const folder = join(reposFolder, name);
        if (!oldCloneName.test(name) || !isFolder(folder) || !existsSync(join(folder, ".git"))) continue;
        // Retries, because a virus scanner or an indexer on Windows can hold a file for a moment.
        // A folder that stays in use throws: the migration fails, and runs again at the next start.
        rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
        deleted.add(key(folder));
      }
    }
    deleteOldChats(context, deleted);
    return "done";
  },
};

/** Deletes each chat that worked in an old clone, with its forks, and their step details. */
function deleteOldChats(context: Parameters<Migration["run"]>[0], deleted: ReadonlySet<string>): void {
  const read = readJsonTolerant(context.paths.sessions);
  if (!read.ok || !isObject(read.value) || !Array.isArray(read.value["sessions"])) return;
  const sessions = read.value["sessions"] as unknown[];
  const gone = new Set<string>();
  for (const session of sessions) {
    if (!isObject(session) || typeof session["id"] !== "string") continue;
    const folder = session["startFolder"];
    if (session["mode"] === "project" && typeof folder === "string" && isOldClone(folder, deleted))
      gone.add(session["id"]);
  }
  // A fork goes with its chat. The loop runs until no new fork joins.
  for (let added = true; added;) {
    added = false;
    for (const session of sessions) {
      if (!isObject(session) || typeof session["id"] !== "string" || gone.has(session["id"])) continue;
      if (typeof session["parentId"] === "string" && gone.has(session["parentId"])) {
        gone.add(session["id"]);
        added = true;
      }
    }
  }
  if (gone.size === 0) return;
  const kept = sessions.filter((session) => !(isObject(session) && gone.has(session["id"] as string)));
  context.write(context.paths.sessions, JSON.stringify({ ...read.value, sessions: kept }, null, 2) + "\n");
  for (const id of gone) {
    // Only a plain id names a file, as in the step details store.
    if (/^[\w-]+$/.test(id)) rmSync(join(context.paths.stepDetails, `${id}.json`), { force: true });
  }
}

/**
 * A chat's folder is an old clone when the migration deleted it. It is one too when it has the old
 * name and is already gone, for example deleted by hand. A `clone-<n>` name can be a new clone, so
 * only the delete above counts for it.
 */
function isOldClone(folder: string, deleted: ReadonlySet<string>): boolean {
  if (deleted.has(key(folder))) return true;
  const parent = basename(dirname(folder));
  if ((process.platform === "win32" ? parent.toLowerCase() : parent) !== "repos") return false;
  const name = basename(folder);
  return oldCloneName.test(name) && !newCloneName.test(name) && !existsSync(folder);
}

/** One key per folder: Windows paths ignore case. */
function key(folder: string): string {
  const absolute = resolve(folder);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function namesIn(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
