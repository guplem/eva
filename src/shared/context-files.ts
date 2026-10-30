/** Reads the files of a chat's context for an engine adapter: its instruction files and its skills. */
import { readdirSync } from "node:fs";
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

/** Each skill in a skills folder: a folder with a `SKILL.md`, by name. A missing folder has none. */
export function skillParts(skillsFolder: string): ContextPart[] {
  let names: string[];
  try {
    names = readdirSync(skillsFolder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(skillsFolder, name, "SKILL.md");
    const text = readTextTolerant(path);
    return text === null ? [] : [{ group: "skills" as const, title: name, source: path, text, note: null }];
  });
}
