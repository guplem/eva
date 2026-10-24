/**
 * Claude Code keeps each chat by the folder where it started: `<config>/projects/<folder name>/<id>.jsonl`.
 * A resume finds a chat only in the folder of its own start folder. So a fork that moves to another
 * clone needs a copy of the chat there first (issue 523). The layout is no public format: the
 * contract test pins it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CarryHistoryInput } from "../../shared/engine-port.ts";

/** Claude Code shortens a longer name with a hash that Eva cannot rebuild. */
const longestName = 200;
/** An engine session id goes into a file name, so it holds only safe characters. */
const idPattern = /^[\w-]+$/;

/** The name of the folder that holds the chats of a start folder, or null when Claude Code shortens it. */
export function claudeProjectFolder(startFolder: string): string | null {
  const name = startFolder.replace(/[^a-zA-Z0-9]/g, "-");
  return name.length > longestName ? null : name;
}

/** Copies the chat into the folder of the new start folder. False when Eva cannot find or place it. */
export function carryClaudeHistory(input: CarryHistoryInput): boolean {
  if (!idPattern.test(input.engineSessionId)) return false;
  const projects = join(input.environment["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"), "projects");
  const source = newestCopy(projects, `${input.engineSessionId}.jsonl`);
  if (source === null) return false;
  // Claude Code may name the folder after the real path, such as `/private/tmp` for `/tmp` on macOS.
  const names = new Set([input.toFolder, realPath(input.toFolder)].map(claudeProjectFolder));
  if (names.has(null)) return false;
  for (const name of names) {
    if (name === null) continue;
    const target = join(projects, name, `${input.engineSessionId}.jsonl`);
    if (target === source) continue;
    mkdirSync(join(projects, name), { recursive: true });
    copyFileSync(source, target);
  }
  return true;
}

/** The newest file of that name in any chat folder: a chat that ran in two folders has two copies. */
function newestCopy(projects: string, fileName: string): string | null {
  let names: string[];
  try {
    names = readdirSync(projects);
  } catch {
    return null;
  }
  let newest: { path: string; time: number } | null = null;
  for (const name of names) {
    const path = join(projects, name, fileName);
    if (!existsSync(path)) continue;
    const time = statSync(path).mtimeMs;
    if (newest === null || time > newest.time) newest = { path, time };
  }
  return newest?.path ?? null;
}

function realPath(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    // The folder may not exist yet. Its own path is then the only name.
    return folder;
  }
}
