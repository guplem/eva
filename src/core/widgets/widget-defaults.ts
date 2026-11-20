/**
 * The default place of a folder or a file input (#984): the form offers it with one tap, and Eva
 * creates a missing default folder. The rules are the rules of every widget place.
 */
import { lstatSync, mkdirSync, type Stats, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { openPath } from "./widget-places.ts";

/**
 * Git keeps no empty folder, so a new folder gets this empty file, as each empty folder of the
 * vault template does. The sync then keeps it, and another computer finds it.
 */
export const keepFileName = ".gitkeep";

/** What a default place is on the disk: "missing" is a folder that Eva can create. Null: no widget may use it. */
export type DefaultPlace = "folder" | "file" | "missing" | null;

/**
 * What the default is on the disk: a folder, a file, or "missing" when Eva can create it as a
 * folder. Null when the way holds a link or a file, or when no widget may reach the place.
 */
export function defaultPlace(vaultPath: string, path: string): DefaultPlace {
  const segments = openPath(path);
  if (segments === null) return null;
  for (let index = 1; index <= segments.length; index += 1) {
    const stats = lstatOrNull(join(vaultPath, ...segments.slice(0, index)));
    if (stats === null) return "missing";
    if (stats.isSymbolicLink()) return null;
    if (index === segments.length) return stats.isDirectory() ? "folder" : stats.isFile() ? "file" : null;
    if (!stats.isDirectory()) return null;
  }
  return null;
}

/** Creates the default folder and each missing parent. A folder that exists stays as it is. */
export function createDefaultFolder(vaultPath: string, path: string): void {
  const place = defaultPlace(vaultPath, path);
  if (place === "folder") return;
  if (place !== "missing") throw new EvaError("widget_invalid", `Eva cannot create the folder ${path}.`);
  const target = join(vaultPath, ...path.split("/"));
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, keepFileName), "");
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
