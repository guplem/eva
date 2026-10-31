/**
 * Which files of the vault are secret, so Eva encrypts them (#707). The defaults live here, so an
 * update can add one to every vault. The person's changes live in the vault's `.eva/secret-files`,
 * in `.gitignore` syntax: a line adds a pattern, and a `!` line turns a default off.
 *
 * Only the vault uses this list. Each code repository keeps its own rules, such as its `.gitignore`.
 */
import { join } from "node:path";
import { readTextTolerant } from "../../shared/files.ts";

/**
 * Files that hold secrets by convention. A plain `.env` holds values that are safe to share, such as
 * build settings, and so do the example files, such as `.env.example`. A release that takes out a
 * default is a breaking change: see `src/core/vault/AGENTS.md`.
 */
export const defaultSecretPatterns: readonly string[] = [
  ".env.local",
  ".env.*.local",
  ".env.secrets",
  "*.secrets",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "secrets.json",
  "credentials.json",
  "client_secret*.json",
];

/** The vault's file of the person's changes to the list. */
export const secretFilesPath = ".eva/secret-files";

export interface SecretFilesChanges {
  /** The patterns that the person added. */
  readonly added: readonly string[];
  /** The defaults that the person turned off, without their `!`. */
  readonly off: readonly string[];
}

/** Reads the person's changes. A missing or unreadable file means no change. */
export function readSecretFiles(vaultPath: string): SecretFilesChanges {
  return parseSecretFiles(readTextTolerant(join(vaultPath, secretFilesPath)) ?? "");
}

export function parseSecretFiles(text: string): SecretFilesChanges {
  const added: string[] = [];
  const off: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      if (line.length > 1) off.push(line.slice(1));
    } else added.push(line);
  }
  return { added, off };
}

/**
 * Eva's settings, the instruction files and git's own files stay plain whatever the list says. A
 * pattern such as `**` would otherwise stop the Assistant and every specialist, and hide the key file.
 */
export function isNeverEncrypted(relativePath: string): boolean {
  const path = normalized(relativePath);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return path.startsWith(".eva/") || name === "agents.md" || name === ".gitignore" || name === ".gitattributes";
}

/** Matches vault paths, from the vault root with `/`, against patterns in `.gitignore` syntax. */
export class SecretMatcher {
  private readonly rules: readonly { readonly glob: Bun.Glob; readonly negated: boolean }[];

  constructor(patterns: readonly string[]) {
    this.rules = patterns.flatMap((pattern) => {
      const negated = pattern.startsWith("!");
      const glob = globOf(negated ? pattern.slice(1) : pattern);
      return glob === null ? [] : [{ glob: new Bun.Glob(glob), negated }];
    });
  }

  /** True for a file that Eva encrypts. As in `.gitignore`, the last pattern that matches wins. */
  matches(relativePath: string): boolean {
    if (isNeverEncrypted(relativePath)) return false;
    const path = normalized(relativePath);
    let secret = false;
    for (const rule of this.rules) if (rule.glob.match(path)) secret = !rule.negated;
    return secret;
  }
}

/** The glob of one `.gitignore` pattern, in lower case, or null for an empty one. */
function globOf(pattern: string): string | null {
  let glob = pattern.trim().toLowerCase().replace(/\\/g, "/");
  if (glob === "" || glob === "/") return null;
  // A pattern with no slash before its end matches a name in any folder; one with a slash starts at the root.
  const anchored = glob.slice(0, -1).includes("/");
  // A folder pattern covers each file under it.
  if (glob.endsWith("/")) glob = `${glob}**`;
  if (glob.startsWith("/")) return glob.slice(1);
  return anchored ? glob : `**/${glob}`;
}

/** Windows, and macOS by default, ignore case, and Windows drops trailing dots and spaces of a name. */
function normalized(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[. ]+$/, "").toLowerCase())
    .join("/");
}
