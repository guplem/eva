/**
 * Which files of the vault the Files page, downloads, search, Telegram and mentions treat as secret
 * (#707). One list for every use: the defaults, the person's patterns and a signed removal, as the
 * vault says them. An encrypted file opens only in the Files page, with the vault password.
 */
import { closeSync, openSync, readSync } from "node:fs";
import { defaultSecretPatterns, readSecretFiles, retiredSecretPatterns, SecretMatcher } from "../vault/secret-files.ts";
import { activeSecretPatterns } from "../vault/secret-policy.ts";
import { readSignedState, readVaultKey } from "../vault/secret-state.ts";
import { encryptedState } from "../vault/vault-crypto.ts";

/** Checks a forward-slash path from the vault root. */
export interface SecretPaths {
  matches(path: string): boolean;
}

/**
 * A plain env file, such as `.env` or `.env.production`. The vault keeps it plain, so a program can
 * read it. It can still hold a password with no token shape that the redactor knows, so no page shows it.
 */
const envName = /^\.env(\..*)?$|\.env$/;

/** The vault's secret files now, plus each plain env file. Build it once for a walk of many files. */
export function secretMatcherOf(vaultPath: string): SecretPaths {
  const key = readVaultKey(vaultPath);
  const signed = key === null ? null : readSignedState(vaultPath, key, 0);
  const { active } = activeSecretPatterns({
    defaults: defaultSecretPatterns,
    retired: retiredSecretPatterns,
    changes: readSecretFiles(vaultPath),
    signed,
    applied: [],
  });
  const matcher = new SecretMatcher(active);
  return {
    matches: (path) =>
      // Windows drops trailing dots and spaces, so `.env.` opens `.env`.
      matcher.matches(path) || envName.test((path.split("/").pop() ?? "").toLowerCase().replace(/[. ]+$/, "")),
  };
}

/** True for a file that starts with Eva's header, whatever its name, such as a conflict copy. */
export function isEncryptedOnDisk(absolutePath: string): boolean {
  let descriptor: number;
  try {
    descriptor = openSync(absolutePath, "r");
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(400);
    return encryptedState(buffer.subarray(0, readSync(descriptor, buffer, 0, buffer.length, 0))) !== "plain";
  } catch {
    return false;
  } finally {
    closeSync(descriptor);
  }
}
