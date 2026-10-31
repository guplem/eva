/**
 * The places of the vault that a widget may reach (#691), as rules on paths only. The web page
 * uses the same rules for its vault picker, so this file reads no disk. `widget-data.ts` adds the
 * checks that need the disk, such as a symbolic link.
 *
 * A path here is a forward-slash path from the vault root, such as `Life/Habits/walk.json`.
 */

/** The file names that an agent reads as its rules, or that a later issue reads as a data format (#692). */
const ruleFiles: ReadonlySet<string> = new Set(["agents.md", "claude.md", "readme.md", "data_format.md"]);
/** The contract says a data file is JSON or YAML. */
const dataExtensions = /\.(?:json|ya?ml)$/i;
/** The characters that Windows refuses in a name, and `%`, so an encoded `..` never reads as a name. */
const refusedCharacters = /[\\:%<>"|?*]/;
/** A control character, such as NUL, can cut a name short in a system call. */
const controlCharacter = /\p{Cc}/u;
/** A short 8.3 name of Windows, such as `ABOUTM~1.MD`, names a long file by another name. */
const shortName = /~\d/;
/** A device name of Windows, such as `NUL` or `COM1.json`, opens a device, not a file. */
const deviceName = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/**
 * A name as a file system that ignores case can read it. Windows folds `ſ` to `S` and the Kelvin
 * sign to `K`, so Eva folds both ways, after the compatibility form of Unicode.
 */
function folded(name: string): string {
  return name.normalize("NFKC").toUpperCase().toLowerCase();
}

/** The segments of a path, or null when one segment is not a plain name. */
export function pathSegments(path: string): string[] | null {
  const segments = path.split("/");
  return segments.every(isPlainName) ? segments : null;
}

/**
 * True for a name that means only itself on every system: no `.` or `..`, no hidden name, no
 * name that Windows reads as another one (a trailing dot or space, a stream, a short name).
 */
export function isPlainName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith(".") &&
    !name.endsWith(".") &&
    !name.endsWith(" ") &&
    !refusedCharacters.test(name) &&
    !controlCharacter.test(name) &&
    !deviceName.test(name) &&
    !shortName.test(name)
  );
}

/**
 * True for a place that no widget ever reaches, at any depth: the vault root, `Scratch/`, the
 * clones of a project, and the person's facts. Hidden names, such as `.git/` and `.eva/`, fail
 * `isPlainName` already. Eva compares without case, as the vault sync does for `Scratch`.
 */
export function isClosedPlace(segments: readonly string[]): boolean {
  const lower = segments.map(folded);
  if (lower.length === 0 || (lower.length === 1 && lower[0] === "")) return true;
  if (lower[0] === "scratch") return true;
  if (lower[0] === "projects" && lower[2] === "repos") return true;
  return lower[0] === "life" && lower[1] === "about me.md";
}

/** The segments of a path that a widget may reach, or null. */
export function openPath(path: string): string[] | null {
  const segments = pathSegments(path);
  return segments === null || isClosedPlace(segments) ? null : segments;
}

/** True for a file name that a widget may write: a JSON or YAML file that no agent reads as rules. */
export function isWritableName(name: string): boolean {
  return isPlainName(name) && dataExtensions.test(name) && !ruleFiles.has(folded(name));
}

/** True when a file name matches a `files` pattern of the manifest: `*` is any text, `?` one character. */
export function matchesFiles(pattern: string, name: string): boolean {
  // The manifest schema allows only ASCII in a pattern, so a split by code unit is safe.
  const source = pattern
    .split("")
    .map((character) =>
      character === "*" ? "[^/]*" : character === "?" ? "[^/]" : character.replace(/[.+^${}()|[\]\\-]/g, "\\$&"),
    )
    .join("");
  // Without case, as Eva compares every other name.
  return new RegExp(`^${source}$`, "i").test(name);
}

/** True for the data format of a folder (#692): it is for agents, never a data file of a widget. */
export function isDataFormatFile(name: string): boolean {
  return folded(name) === "data_format.md";
}
