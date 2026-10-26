/**
 * The paths of the Files page. A path goes from the vault root with forward slashes, and the
 * empty path is the root. The address holds the path, so the back button goes up a folder.
 */

const filesPrefix = "#/files";

export function fileAddressOf(path: string): string {
  if (path === "") return filesPrefix;
  return `${filesPrefix}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The path that the address names, or null for an address of another page. A `.` or `..` part
 * folds away, so the crumbs and the child links name the folder that the core lists.
 */
export function filePathOf(hash: string): string | null {
  if (hash !== filesPrefix && !hash.startsWith(`${filesPrefix}/`)) return null;
  let parts: string[];
  try {
    parts = hash.slice(filesPrefix.length).split("/").map(decodeURIComponent);
  } catch {
    // A hand-typed address with a bad `%` escape.
    return "";
  }
  const folded: string[] = [];
  for (const part of parts) {
    if (part === "..") folded.pop();
    else if (part !== "" && part !== ".") folded.push(part);
  }
  return folded.join("/");
}

export interface PathCrumb {
  readonly name: string;
  readonly path: string;
}

export function pathCrumbs(path: string): PathCrumb[] {
  const parts = path === "" ? [] : path.split("/");
  return [
    { name: "Vault", path: "" },
    ...parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") })),
  ];
}

/** The folder that holds the path, or null for the root. */
export function parentOf(path: string): string | null {
  if (path === "") return null;
  return path.split("/").slice(0, -1).join("/");
}

/** True for `folder` itself and for each path inside it. */
export function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export function childPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

export function sizeWords(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The YAML block at the start of a note. Markdown would read its closing `---` as a rule. */
export function splitFrontMatter(text: string): { frontMatter: string | null; body: string } {
  const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/.exec(text);
  if (match === null) return { frontMatter: null, body: text };
  return { frontMatter: match[1] ?? "", body: text.slice(match[0].length) };
}

/** A first word in lower case and a space start a command, such as `cd Notes/a`. */
const commandPattern = /^[a-z][\w-]*\s/;
/** Shell signs never sit in a note name. Brackets and an apostrophe do, as in `Book (2024).md`. */
const shellSignPattern = /[\\*?<>|"`$;={}@]/;
/** An agent cites a note with a heading or a line, as in `Notes/a.md#Plan` or `Notes/a.md:12`. */
const placeSuffixPattern = /(?:(?<=\.md)#[^/]*|:\d+(?::\d+)?)$/i;

/**
 * The vault path that a code span of an Assistant answer names, or null. Its agent works in
 * the vault root, so a relative path is a vault path. A lone name counts only as a folder
 * (`Toolbox/`) or a note (`.md`): `package.json` or `console.log` in an answer is code.
 */
export function vaultPathOf(code: string): string | null {
  let path = code.trim().replace(placeSuffixPattern, "");
  if (commandPattern.test(path) || shellSignPattern.test(path)) return null;
  // A colon starts a drive, as in `C:/vault`, or a remote, as in `host:notes`.
  if (/^[/~]/.test(path) || path.includes(":")) return null;
  const folder = path.endsWith("/");
  path = path.replace(/^\.\//, "").replace(/\/$/, "");
  const parts = path.split("/");
  if (parts.some((part) => part.trim() !== part || part === "" || part === "." || part === "..")) return null;
  if (folder) return path;
  if (parts.length === 1) return /\.md$/i.test(path) ? path : null;
  // `origin/main`, `application/json` and `and/or` are no files. A vault folder starts with a
  // capital or a dot, as in `Toolbox/` or `.eva/`, and a file has an extension.
  if (parts.some((part) => /^[A-Z.]/.test(part)) || /\.[A-Za-z\d]+$/.test(path)) return path;
  return null;
}
