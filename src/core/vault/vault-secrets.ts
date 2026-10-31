/**
 * Encrypts the vault's secret files before Eva commits them or keeps a snapshot (#707). A round reads
 * the list, the key and this machine's memory once, then prepares each file:
 * - a plain secret file is encrypted in place, and the commit takes the encrypted text;
 * - an encrypted file is committed as it is, and never encrypted again;
 * - a file that keeps Eva's header but not the shape of her body stays out;
 * - with no key, or a key that changed, a secret file stays out, plain;
 * - a plain `.env` with a token stays out: it should hold values that are safe to share.
 */
import { closeSync, lstatSync, openSync, readFileSync, readSync, type Stats } from "node:fs";
import { basename, join } from "node:path";
import { writeFileAtomic } from "../../shared/files.ts";
import { containsSecretPattern } from "../../shared/redaction.ts";
import { defaultSecretPatterns, readSecretFiles, SecretMatcher } from "./secret-files.ts";
import { writeSecretAttributes } from "./secret-attributes.ts";
import { activeSecretPatterns, type SecretPolicy } from "./secret-policy.ts";
import { readMachineSecrets, readSignedState, readVaultKey, writeMachineSecrets } from "./secret-state.ts";
import { encryptedState, encryptFile, hasEncryptedShape, keyFingerprint } from "./vault-crypto.ts";
import type { PrepareFile, WithheldReason } from "./vault-sync.ts";

/** The defaults that a release took out. They apply until the person confirms each removal. */
export const retiredSecretPatterns: readonly string[] = [];

/** Base64 adds about a third, and the commit limit is 50 MB: a bigger file stays out. */
const maxEncryptedBytes = 25 * 1024 * 1024;
/** A `.env` over this size is not scanned, as the other files of the vault. */
const maxScannedBytes = 1_000_000;

export interface VaultSecretsOptions {
  readonly vaultPath: string;
  /** This machine's own memory, in its state folder: never in the vault. */
  readonly machineStatePath: string;
}

export class VaultSecrets {
  private readonly options: VaultSecretsOptions;

  constructor(options: VaultSecretsOptions) {
    this.options = options;
  }

  /** The patterns that apply now, and the removals that wait. */
  policy(): SecretPolicy {
    return this.state().policy;
  }

  /** One file, in a round of its own. A commit uses `round` to read the state once. */
  prepare(relativePath: string): WithheldReason | null {
    return this.round()(relativePath);
  }

  /**
   * True for a committed file that the list matches and that is not encrypted in Eva's exact shape.
   * A file that a removal decrypted no longer matches, so it is plain on purpose.
   */
  isPlainSecret(relativePath: string, bytes: Uint8Array): boolean {
    if (!new SecretMatcher(this.policy().active).matches(relativePath)) return false;
    const state = encryptedState(bytes);
    return state === "plain" || (state === "encrypted" && !hasEncryptedShape(bytes));
  }

  round(): PrepareFile {
    const { key, keyChanged, policy, removed } = this.state();
    // Before any file of the round, so the commit that brings an encrypted file also marks it.
    writeSecretAttributes(this.options.vaultPath, policy.active, removed);
    const matcher = new SecretMatcher(policy.active);
    return (relativePath) => {
      const path = join(this.options.vaultPath, relativePath);
      let info: Stats;
      try {
        info = lstatSync(path);
      } catch {
        return null;
      }
      const secret = matcher.matches(relativePath);
      // A link is never followed: its target could be Eva's own file, or outside the vault.
      if (!info.isFile()) return secret && info.isSymbolicLink() ? "secret" : null;
      const state = encryptedState(readHead(path));
      if (state === "newer") return null;
      if (state === "encrypted") return hasEncryptedShape(readFileSync(path)) ? null : "not_decryptable";
      if (!secret) return plainEnvWithSecret(relativePath, path, info.size) ? "env_has_secret" : null;
      if (key === null) return "no_vault_key";
      if (keyChanged) return "vault_key_changed";
      if (info.size > maxEncryptedBytes) return "too_large";
      writeFileAtomic(path, new TextDecoder().decode(encryptFile(readFileSync(path), key)));
      return null;
    };
  }

  private state(): {
    key: ReturnType<typeof readVaultKey>;
    keyChanged: boolean;
    policy: SecretPolicy;
    /** The patterns that a signed removal took out. */
    removed: ReadonlySet<string>;
  } {
    const key = readVaultKey(this.options.vaultPath);
    const machine = readMachineSecrets(this.options.machineStatePath);
    const fingerprint = key === null ? null : keyFingerprint(key);
    // The first key that this machine sees is the vault's. Another one later is the person's to confirm.
    const keyChanged = machine.fingerprint !== null && fingerprint !== null && fingerprint !== machine.fingerprint;
    const signed = key === null || keyChanged ? null : readSignedState(this.options.vaultPath, key, machine.sequence);
    const policy = activeSecretPatterns({
      defaults: defaultSecretPatterns,
      retired: retiredSecretPatterns,
      changes: readSecretFiles(this.options.vaultPath),
      signed,
      applied: machine.applied,
    });
    const next = {
      fingerprint: machine.fingerprint ?? fingerprint,
      sequence: Math.max(machine.sequence, signed?.sequence ?? 0),
      applied: [...policy.active],
    };
    if (JSON.stringify(next) !== JSON.stringify(machine)) writeMachineSecrets(this.options.machineStatePath, next);
    const removed = new Set(signed?.known.filter((pattern) => !policy.active.includes(pattern)) ?? []);
    return { key, keyChanged, policy, removed };
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

/** A plain `.env` holds values that are safe to share. One with a known token shape holds a secret. */
function plainEnvWithSecret(relativePath: string, path: string, size: number): boolean {
  const name = basename(relativePath).toLowerCase();
  if (!(name === ".env" || name.endsWith(".env")) || size > maxScannedBytes) return false;
  return containsSecretPattern(readFileSync(path, "utf8"));
}
