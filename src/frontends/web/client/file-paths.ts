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

export function childPath(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
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
