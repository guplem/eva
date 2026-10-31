/**
 * The encrypted files of the vault, with an unlocked key (#707): read one for the Files page, save
 * new text, decrypt what a confirmed removal frees, and encrypt every file again for a new key. Only
 * a request of the person's own device reaches these: the text never goes into an event, a log or
 * a chat. Every path stays inside the vault, and Eva follows no link.
 */
import { closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import type { SecretMatcher } from "./secret-files.ts";
import { decryptFile, encryptedState, encryptFile, type UnlockedVaultKey, type VaultKeyFile } from "./vault-crypto.ts";

export type OpenedFile =
  | {
      readonly kind: "text";
      readonly text: string;
      /** The version of the encrypted bytes, so a save never writes over a newer change. */
      readonly version: string;
    }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

/** The plain content of an encrypted file. Text only when it is valid UTF-8 with no NUL byte. */
export function readEncryptedFile(vaultPath: string, relativePath: string, unlocked: UnlockedVaultKey): OpenedFile {
  const path = encryptedPath(vaultPath, relativePath);
  const bytes = new Uint8Array(readFileSync(path));
  const plain = decryptFile(bytes, unlocked);
  const text = asText(plain);
  return text === null ? { kind: "binary", bytes: plain } : { kind: "text", text, version: versionOf(bytes) };
}

/** Writes the new text, encrypted. Throws `file_changed` when the file changed since it was read. */
export function saveEncryptedFile(
  vaultPath: string,
  relativePath: string,
  text: string,
  version: string,
  key: Pick<VaultKeyFile, "publicKey" | "signingKey">,
): void {
  const path = encryptedPath(vaultPath, relativePath);
  if (versionOf(new Uint8Array(readFileSync(path))) !== version)
    throw new EvaError("file_changed", "The file changed since you opened it. Open it again.");
  writeFileAtomic(path, new TextDecoder().decode(encryptFile(new TextEncoder().encode(text), key)));
}

/**
 * Decrypts each encrypted file that a removed pattern covered and that no active pattern covers. A
 * file that no pattern ever named, such as a conflict copy, stays as it is. Gives the paths.
 */
export function decryptRemovedFiles(
  vaultPath: string,
  removed: SecretMatcher,
  active: SecretMatcher,
  unlocked: UnlockedVaultKey,
): string[] {
  const decrypted: string[] = [];
  for (const relativePath of encryptedFiles(vaultPath)) {
    if (!removed.matches(relativePath) || active.matches(relativePath)) continue;
    const path = join(vaultPath, relativePath);
    // The bytes as they are: a binary file, such as a `.p12`, must not pass through a text decoder.
    writeFileAtomic(path, decryptFile(new Uint8Array(readFileSync(path)), unlocked));
    decrypted.push(relativePath);
  }
  return decrypted;
}

/**
 * Encrypts each encrypted file again, to a new key. A file that the old key does not open stays as
 * it is, and its path comes back, so the person hears of it.
 */
export function encryptAgain(
  vaultPath: string,
  unlocked: UnlockedVaultKey,
  next: Pick<VaultKeyFile, "publicKey" | "signingKey">,
): { moved: string[]; unreadable: string[] } {
  const moved: string[] = [];
  const unreadable: string[] = [];
  for (const relativePath of encryptedFiles(vaultPath)) {
    const path = join(vaultPath, relativePath);
    try {
      const plain = decryptFile(new Uint8Array(readFileSync(path)), unlocked);
      writeFileAtomic(path, new TextDecoder().decode(encryptFile(plain, next)));
      moved.push(relativePath);
    } catch {
      unreadable.push(relativePath);
    }
  }
  return { moved, unreadable };
}

/** Each regular file of the vault with Eva's header, outside git's folder, the clones and Scratch. */
function encryptedFiles(vaultPath: string): string[] {
  const found: string[] = [];
  const visit = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(join(vaultPath, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skippedFolder(relativePath)) visit(relativePath);
      } else if (entry.isFile() && encryptedState(readHead(join(vaultPath, relativePath))) === "encrypted")
        found.push(relativePath);
    }
  };
  visit("");
  return found.sort();
}

function skippedFolder(relativePath: string): boolean {
  const parts = relativePath.split("/");
  const top = parts[0]?.toLowerCase();
  return (
    parts.at(-1) === ".git" || top === "scratch" || (top === "projects" && parts.length === 3 && parts[2] === "repos")
  );
}

/** The path of an encrypted regular file inside the vault, or an error that the person can read. */
function encryptedPath(vaultPath: string, relativePath: string): string {
  const notFound = (): EvaError => new EvaError("file_not_found", `${relativePath} is not an encrypted file.`);
  if (isAbsolute(relativePath)) throw notFound();
  const path = join(vaultPath, relativePath);
  let inside: string;
  try {
    inside = relative(realpathSync(vaultPath), realpathSync(path));
  } catch {
    throw notFound();
  }
  if (inside.startsWith("..") || isAbsolute(inside) || inside.split(sep).some((part) => part.toLowerCase() === ".git"))
    throw notFound();
  // A link is never followed: its target could be Eva's own file, or outside the vault.
  if (!lstatSync(path).isFile() || encryptedState(readHead(path)) !== "encrypted") throw notFound();
  return path;
}

function versionOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function asText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The first bytes of a file: enough for Eva's two header lines. */
function readHead(path: string): Uint8Array {
  const buffer = Buffer.alloc(400);
  const descriptor = openSync(path, "r");
  try {
    return buffer.subarray(0, readSync(descriptor, buffer, 0, buffer.length, 0));
  } finally {
    closeSync(descriptor);
  }
}
