/**
 * The file wall of a Project chat (#711): whether an agent's file tool may open a path. A chat
 * opens its own folder, its "area", but no closed folder, such as the vault. Both engines use it.
 * A path is resolved first and checked after (lesson 72). The walk goes part by part, as the system
 * opens it: each link is followed where it stands, so a `..` after a link goes up from the link's
 * target, not from the link's name.
 */
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, sep } from "node:path";

/** True when `path` is `root` or inside it. Both are resolved, absolute paths. */
export function isInside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between === "" || (!between.startsWith(`..${sep}`) && between !== ".." && !isAbsolute(between));
}

/** Enough to end a loop of links. */
const linkHops = 40;
/** More forms than this, such as from many braces, are refused: a person's pattern never needs them. */
const patternForms = 256;

/** The folders of a Project chat's wall: its own folder, and the folders that it may not open. */
export interface WallFolders {
  readonly area: string;
  readonly closed: readonly string[];
}

/**
 * True when a file tool may not open `requested`: a path inside a closed folder, such as the vault,
 * but not inside the chat's own folder. A folder that holds a closed one is refused too, since a
 * search from it would reach in. The other files of the machine stay open, as the issue asks.
 */
export function wallRefusesPath(wall: WallFolders, requested: string, cwd: string): boolean {
  const real = realOf(requested, cwd);
  if (real === null) return true;
  const path = folded(real);
  const area = realFolder(wall.area);
  if (area !== null && isInside(folded(area), path)) return false;
  return wall.closed.some((closed) => {
    const folder = realFolder(closed);
    return folder !== null && (isInside(folded(folder), path) || isInside(path, folded(folder)));
  });
}

/**
 * True when a file pattern, such as a Glob, may reach a closed folder. Each form of its braces is
 * checked from its fixed folder, the parts before its first wildcard. A `..` after a wildcard, an
 * extglob such as `+(.)`, and a character class with a dot, such as `[.]`, are refused.
 */
export function wallRefusesPattern(wall: WallFolders, pattern: string, cwd: string): boolean {
  if (/[+@!?*]\(/.test(pattern) || /\[[^\]]*\.[^\]]*\]/.test(pattern)) return true;
  const forms = expandBraces(pattern);
  if (forms === null) return true;
  const separators = process.platform === "win32" ? /[\\/]/ : /\//;
  return forms.some((form) => {
    const parts = form.split(separators);
    const wild = parts.findIndex((part) => /[*?[]/.test(part));
    if (wild !== -1 && parts.slice(wild).includes("..")) return true;
    const fixed = (wild === -1 ? parts : parts.slice(0, wild)).join(sep);
    // `/x` splits into an empty first part: the search starts at the root. `C:` alone is a drive.
    const absolute = parts[0] === "" && form.length > 0 ? sep : "";
    const base = /^[A-Za-z]:$/.test(fixed) ? `${fixed}${sep}` : `${absolute}${fixed}`;
    return wallRefusesPath(wall, base === "" ? cwd : base, cwd);
  });
}

/**
 * True for a write that could run code at the chat's next turn: the folder's own Claude Code or pi
 * settings, its MCP servers, or a git folder anywhere in it, such as `.git/hooks` or `.git/config`.
 */
export function isProtectedInArea(area: string, requested: string, cwd: string): boolean {
  const real = realOf(requested, cwd);
  const root = realFolder(area);
  if (real === null || root === null || !isInside(folded(root), folded(real))) return false;
  const parts = relative(root, real)
    .split(sep)
    .map((part) => part.toLowerCase());
  return (
    parts.includes(".git") ||
    parts[0] === ".claude" ||
    parts[0] === ".pi" ||
    (parts.length === 1 && parts[0] === ".mcp.json")
  );
}

/** The real path that a tool would open for `requested`, or null when Eva cannot tell. */
function realOf(requested: string, cwd: string): string | null {
  const asked = toolPath(requested);
  if (asked === null) return null;
  return walk(isAbsolute(asked) ? asked : `${cwd}${sep}${asked}`, linkHops)?.path ?? null;
}

function realFolder(folder: string): string | null {
  try {
    return realpathSync.native(folder);
  } catch {
    return null;
  }
}
/**
 * The path that a file tool opens, or null for one that it would expand into a place that a check
 * by text cannot follow, such as `~` for the home folder.
 */
function toolPath(requested: string): string | null {
  const path = withoutLongPrefix(requested);
  if (path.startsWith("~") || /^file:/i.test(path)) return null;
  if (process.platform !== "win32") return path;
  // A Windows variable names a place that only the tool knows. `D:x` starts at that drive's own current folder.
  if (/%[^%\\/]+%/.test(path) || /^[A-Za-z]:(?![\\/])/.test(path) || hasStream(path)) return null;
  // Git Bash and pi write `C:\x` as `/c/x`.
  const drive = /^\/([A-Za-z])(\/|$)/.exec(path);
  return drive === null ? path : `${drive[1] ?? ""}:\\${path.slice(3)}`;
}

/**
 * The real path, walked from the root one part at a time. A link is followed where it stands. A
 * part that does not exist keeps its name, and a `..` after one is refused: the system would decide.
 */
function walk(absolute: string, hops: number): { path: string; exists: boolean } | null {
  if (hops <= 0) return null;
  const { root } = parse(absolute);
  let current: string;
  try {
    current = realpathSync.native(root);
  } catch {
    return null;
  }
  const parts = absolute.slice(root.length).split(process.platform === "win32" ? /[\\/]+/ : /\/+/);
  let exists = true;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!exists) return null;
      current = dirname(current);
      continue;
    }
    const next = join(current, trimmedName(part));
    if (!exists) {
      current = next;
      continue;
    }
    let link: boolean;
    try {
      link = lstatSync(next).isSymbolicLink();
    } catch {
      exists = false;
      current = next;
      continue;
    }
    if (!link) {
      // The real name, as the system stores it: Windows opens a short name such as `GUILLE~1` too.
      current = realpathSync.native(next);
      continue;
    }
    const target = readlinkSync(next);
    const followed = walk(isAbsolute(target) ? target : `${current}${sep}${target}`, hops - 1);
    if (followed === null) return null;
    ({ path: current, exists } = followed);
  }
  return { path: current, exists };
}

/** Each form of a pattern's braces, such as `a.ts` and `a.tsx` for `a.{ts,tsx}`, or null for too many. */
function expandBraces(pattern: string): string[] | null {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  const commas: number[] = [];
  for (let index = open; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    } else if (char === "," && depth === 1) commas.push(index);
  }
  // An open brace with no close is plain text to a glob.
  if (close === -1) return [pattern];
  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  // A brace with no comma is plain text too, so only the text after it can hold more.
  const choices =
    commas.length === 0
      ? [pattern.slice(open, close + 1)]
      : [open, ...commas].map((start, index) => pattern.slice(start + 1, [...commas, close][index]));
  const tails = expandBraces(after);
  if (tails === null) return null;
  const forms: string[] = [];
  for (const choice of choices) {
    // A choice can hold braces of its own, such as `{a,{b,c}}`.
    const inner = commas.length === 0 ? [choice] : expandBraces(choice);
    if (inner === null) return null;
    for (const middle of inner) for (const tail of tails) forms.push(`${before}${middle}${tail}`);
    if (forms.length > patternForms) return null;
  }
  return forms;
}

/** Windows drops the trailing dots and spaces of a name, so `clone-0 .` opens `clone-0`. */
function trimmedName(name: string): string {
  return process.platform === "win32" ? name.replace(/[. ]+$/, "") : name;
}

/** Windows and macOS find a name in any case, so the check compares with no case there. */
function folded(path: string): string {
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path;
}

/** `\\?\C:\x` is `C:\x`, and `\\?\UNC\host\x` is `\\host\x`. */
function withoutLongPrefix(path: string): string {
  if (!path.startsWith("\\\\?\\")) return path;
  const rest = path.slice(4);
  return rest.startsWith("UNC\\") ? `\\\\${rest.slice(4)}` : rest;
}

/** A colon after the drive letter names a file stream on Windows, which a name check cannot see through. */
function hasStream(path: string): boolean {
  return path.replace(/^[A-Za-z]:/, "").includes(":");
}

/** The fields of a tool call that name a file or a folder, on any tool, so a new tool is walled too. */
const pathKeys = ["file_path", "path", "notebook_path", "local_path", "filePath"];
const pathListKeys = ["file_paths", "paths"];

/**
 * True when the wall refuses a tool call: a path or a pattern that a closed folder holds, or, for a
 * write, a file that could run code at the next turn. `patternKeys` names the fields that hold a
 * file pattern. A relative path starts at `cwd`.
 */
export function wallRefusesCall(
  wall: WallFolders,
  cwd: string,
  input: unknown,
  options: {
    readonly patternKeys: readonly string[];
    readonly write: boolean;
    /** pi drops a leading `@` from a path. Claude Code opens the name as it is, so the check must too. */
    readonly dropsAt: boolean;
  },
): boolean {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && item !== "");
  const paths = [
    ...pathKeys.flatMap((key) => strings(fields[key])),
    ...pathListKeys.flatMap((key) => strings(fields[key])),
  ].map((path) => (options.dropsAt && path.startsWith("@") ? path.slice(1) : path));
  return (
    paths.some((path) => wallRefusesPath(wall, path, cwd)) ||
    options.patternKeys
      .flatMap((key) => strings(fields[key]))
      .some((pattern) => wallRefusesPattern(wall, pattern, cwd)) ||
    (options.write && paths.some((path) => isProtectedInArea(wall.area, path, cwd)))
  );
}
