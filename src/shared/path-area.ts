/**
 * The file wall of a Project chat (#711): whether a path that an agent's file tool asks for is
 * inside the chat's own folder, its "area". Both engines and the core use it. A path is resolved
 * first and checked after (lesson 72): each link of the part that exists is followed, so a link
 * inside the area that points out stays out.
 */
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** True when `path` is `root` or inside it. Both are resolved, absolute paths. */
export function isInside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between === "" || (!between.startsWith(`..${sep}`) && between !== ".." && !isAbsolute(between));
}

/** Enough to end a loop of links. */
const linkHops = 40;

/**
 * True when `requested`, relative to `cwd` or absolute, names the area or a path inside it. A new
 * file is checked by its nearest folder that exists. An area that does not exist holds nothing.
 */
export function isInsideArea(area: string, requested: string, cwd: string): boolean {
  if (process.platform === "win32" && hasStream(requested)) return false;
  let root: string;
  try {
    root = realpathSync.native(area);
  } catch {
    return false;
  }
  const real = realOf(resolve(cwd, withoutLongPrefix(requested)), linkHops);
  return real !== null && isInside(folded(root), folded(real));
}

/**
 * True when a file pattern, such as a Glob, cannot reach outside the area. A pattern that climbs
 * with `..`, or that starts at home, is refused whole: a brace such as `{src,../x}` can hide it.
 */
export function isPatternInsideArea(area: string, pattern: string, cwd: string): boolean {
  const parts = pattern.split(process.platform === "win32" ? /[\\/,{}]/ : /[/,{}]/);
  if (parts.some((part) => part === "..") || pattern.startsWith("~")) return false;
  // An absolute pattern searches from its own folder: the part before its first wildcard.
  const fixed = pattern.split(/[*?[{]/)[0] ?? "";
  return isInsideArea(area, fixed === "" ? cwd : fixed, cwd);
}

/**
 * The real path, through every link of the part that exists. A part that does not exist yet keeps
 * its name: only a folder that exists can lead out. A dangling link is followed to its target.
 */
function realOf(path: string, hops: number): string | null {
  if (hops <= 0) return null;
  try {
    return realpathSync.native(path);
  } catch {
    // Missing: below.
  }
  try {
    if (lstatSync(path).isSymbolicLink()) return realOf(resolve(dirname(path), readlinkSync(path)), hops - 1);
  } catch {
    // Neither a file nor a link: its folder decides.
  }
  const parent = dirname(path);
  if (parent === path) return null;
  const realParent = realOf(parent, hops);
  return realParent === null ? null : join(realParent, trimmedName(path.slice(parent.length).replace(/^[\\/]+/, "")));
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
  return withoutLongPrefix(path)
    .replace(/^[A-Za-z]:/, "")
    .includes(":");
}
