/**
 * The file wall of a Project chat (#711): whether a path that an agent's file tool asks for is
 * inside the chat's own folder, its "area". Both engines and the core use it. A path is resolved
 * first and checked after (lesson 72). The walk goes part by part, as the system opens it: each link
 * is followed where it stands, so a `..` after a link goes up from the link's target, not from the
 * link's name.
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

/**
 * True when `requested`, relative to `cwd` or absolute, names the area or a path inside it. A new
 * file is checked by its nearest folder that exists. An area that does not exist holds nothing.
 */
export function isInsideArea(area: string, requested: string, cwd: string): boolean {
  const asked = toolPath(requested);
  if (asked === null) return false;
  let root: string;
  try {
    root = realpathSync.native(area);
  } catch {
    return false;
  }
  const real = walk(isAbsolute(asked) ? asked : `${cwd}${sep}${asked}`, linkHops);
  return real !== null && isInside(folded(root), folded(real.path));
}

/**
 * True when a file pattern, such as a Glob, cannot reach outside the area. Each form of its braces
 * is checked, and a form that climbs with `..` is refused. So are the forms that a check by text
 * cannot read: an extglob such as `+(.)`, and a character class that holds a dot, such as `[.]`.
 */
export function isPatternInsideArea(area: string, pattern: string, cwd: string): boolean {
  if (/[+@!?*]\(/.test(pattern) || /\[[^\]]*\.[^\]]*\]/.test(pattern)) return false;
  const forms = expandBraces(pattern);
  if (forms === null) return false;
  const separators = process.platform === "win32" ? /[\\/]/ : /\//;
  return forms.every((form) => {
    if (form.split(separators).includes("..")) return false;
    // An absolute pattern searches from its own folder: the part before its first wildcard.
    const fixed = form.split(/[*?[]/)[0] ?? "";
    return isInsideArea(area, fixed === "" ? cwd : fixed, cwd);
  });
}

/**
 * The path that a file tool opens, or null for one that it would expand into a place that a check
 * by text cannot follow, such as `~` for the home folder. pi drops a leading `@`.
 */
function toolPath(requested: string): string | null {
  const path = withoutLongPrefix(requested.startsWith("@") ? requested.slice(1) : requested);
  if (path.startsWith("~") || /^file:/i.test(path)) return null;
  if (process.platform !== "win32") return path;
  if (hasStream(path)) return null;
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
      current = next;
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
