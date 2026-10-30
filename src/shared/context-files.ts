/** Reads the files of a chat's context for an engine adapter: its instruction files and its skills. */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { ContextPart } from "./chat-context.ts";
import { readTextTolerant } from "./files.ts";

/** The path as the person reads it: relative inside the start folder, absolute outside it. */
export function shownPath(path: string, startFolder: string): string {
  const inside = relative(startFolder, path);
  return inside === "" || inside.startsWith("..") || isAbsolute(inside) ? path : inside;
}

/** An instruction file, or null when it is missing or empty: the engine skips an empty file too. */
export function instructionPart(path: string, startFolder: string): ContextPart | null {
  const text = readTextTolerant(path);
  if (text === null || text.trim() === "") return null;
  return { group: "instructions", title: shownPath(path, startFolder), source: path, text, note: null };
}

/** The sorted names in a folder, or none when the folder is missing. */
function namesIn(folder: string): string[] {
  try {
    return readdirSync(folder).sort();
  } catch {
    return [];
  }
}

/** Follows a link, as the engines do: a skill or a rules folder is often a link to another folder. */
function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Each Markdown file in a folder and the folders under it, as instruction files. */
export function instructionPartsIn(folder: string, startFolder: string, seen = new Set<string>()): ContextPart[] {
  // A link back to a folder above would loop forever, so each real folder is read once.
  const real = realPath(folder);
  if (real === null || seen.has(real)) return [];
  seen.add(real);
  return namesIn(folder).flatMap((name) => {
    const path = join(folder, name);
    if (isFolder(path)) return instructionPartsIn(path, startFolder, seen);
    return name.endsWith(".md") ? (instructionPart(path, startFolder) ?? []) : [];
  });
}

function realPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Each skill in a skills folder: a folder with a `SKILL.md`, by name. A missing folder has none. */
export function skillParts(skillsFolder: string): ContextPart[] {
  return namesIn(skillsFolder).flatMap((name) => {
    const path = join(skillsFolder, name, "SKILL.md");
    const text = isFolder(join(skillsFolder, name)) ? readTextTolerant(path) : null;
    return text === null ? [] : [{ group: "skills" as const, title: name, source: path, text, note: null }];
  });
}
