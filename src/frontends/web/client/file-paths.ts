/**
 * The paths of the Files page. A path goes from the vault root with forward slashes, and the
 * empty path is the root. The address holds the path, so the back button goes up a folder.
 */

const filesPrefix = "#/files";

export function fileAddressOf(path: string): string {
  if (path === "") return filesPrefix;
  return `${filesPrefix}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The path that the address names, or null for an address of another page. */
export function filePathOf(hash: string): string | null {
  if (hash !== filesPrefix && !hash.startsWith(`${filesPrefix}/`)) return null;
  const parts = hash
    .slice(filesPrefix.length)
    .split("/")
    .filter((part) => part !== "");
  try {
    return parts.map(decodeURIComponent).join("/");
  } catch {
    // A hand-typed address with a bad `%` escape.
    return "";
  }
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
