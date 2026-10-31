/**
 * What the person does with the vault's encryption (#707): set the password, unlock and lock a
 * device, read and save an encrypted file, change the patterns, confirm a removal, change the
 * password, make a new key, and accept a key that changed on another machine. Each change of the
 * vault runs between two steps of the vault sync, so it never races a commit.
 */
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import {
  decryptRemovedFiles,
  encryptAgain,
  readEncryptedFile,
  saveEncryptedFile,
  type OpenedFile,
} from "./encrypted-files.ts";
import { defaultSecretPatterns, SecretMatcher, secretFilesPath, type SecretFilesChanges } from "./secret-files.ts";
import { activeSecretPatterns, signedPayload } from "./secret-policy.ts";
import { readVaultKey, writeSignedState, writeVaultKey } from "./secret-state.ts";
import { createVaultKey, keyFingerprint, rewrapVaultKey, unlockVaultKey } from "./vault-crypto.ts";
import type { VaultKeys } from "./vault-keys.ts";
import type { VaultSecrets } from "./vault-secrets.ts";

/** The steps of the vault sync that a change needs. */
export interface VaultSteps {
  /** Runs the work between two sync steps. */
  exclusive<Result>(work: () => Result): Promise<Result>;
  pull(): Promise<unknown>;
  /** Commits, which encrypts the secret files, and pushes. */
  save(): Promise<unknown>;
}

export interface VaultEncryptionOptions {
  readonly vaultPath: () => string | null;
  readonly secrets: () => VaultSecrets | null;
  readonly keys: VaultKeys;
  readonly vault: VaultSteps;
  /** The scrypt cost: only a test lowers it. */
  readonly cost?: { readonly logN: number };
}

export interface VaultSecretsStatus {
  readonly hasKey: boolean;
  /** The vault's key is not the one that this machine pinned: Eva encrypts nothing until the person confirms. */
  readonly keyChanged: boolean;
  /** This device can read encrypted files now. */
  readonly unlocked: boolean;
  /** Each default, with whether the person's file keeps it on. */
  readonly defaults: readonly { readonly pattern: string; readonly on: boolean }[];
  /** The person's own patterns. */
  readonly added: readonly string[];
  /** The patterns that still apply but that the file no longer asks for: removals that wait. */
  readonly waiting: readonly string[];
}

export class VaultEncryption {
  private readonly options: VaultEncryptionOptions;

  constructor(options: VaultEncryptionOptions) {
    this.options = options;
  }

  status(deviceToken: string | null, secret: string | null): VaultSecretsStatus {
    const secrets = this.options.secrets();
    if (secrets === null)
      return { hasKey: false, keyChanged: false, unlocked: false, defaults: [], added: [], waiting: [] };
    const { key, keyChanged, input } = secrets.inputs();
    const off = new Set(input.changes.off);
    return {
      hasKey: key !== null,
      keyChanged,
      unlocked: this.options.keys.isUnlocked(deviceToken, secret),
      defaults: defaultSecretPatterns.map((pattern) => ({ pattern, on: !off.has(pattern) })),
      added: input.changes.added,
      waiting: activeSecretPatterns(input).waiting,
    };
  }

  /** Makes the vault's key. Only after a pull, so two machines never make two keys. */
  async setPassword(password: string): Promise<void> {
    const vaultPath = this.vaultPath();
    const file = await createVaultKey(password, this.options.cost);
    await this.options.vault.pull();
    await this.options.vault.exclusive(() => {
      if (readVaultKey(vaultPath) !== null)
        throw new EvaError("vault_key_invalid", "This vault has a password already. Change it in Settings.");
      writeVaultKey(vaultPath, file);
      this.secrets().pinKey(keyFingerprint(file));
    });
    await this.options.vault.save();
  }

  unlock(deviceToken: string | null, password: string): Promise<string> {
    return this.options.keys.unlock(deviceToken, password);
  }

  lock(deviceToken: string | null): void {
    this.options.keys.lock(deviceToken);
  }

  readFile(deviceToken: string | null, secret: string | null, relativePath: string): OpenedFile {
    return readEncryptedFile(this.vaultPath(), relativePath, this.options.keys.keyFor(deviceToken, secret));
  }

  async saveFile(
    deviceToken: string | null,
    secret: string | null,
    relativePath: string,
    text: string,
    version: string,
  ): Promise<void> {
    this.options.keys.keyFor(deviceToken, secret);
    const vaultPath = this.vaultPath();
    await this.options.vault.exclusive(() => {
      const key = this.currentKey(vaultPath);
      saveEncryptedFile(vaultPath, relativePath, text, version, key);
    });
    await this.options.vault.save();
  }

  /**
   * Writes the person's patterns. An added pattern encrypts its files at the save that follows. A
   * default turned off, or a pattern taken out, waits for a confirmation from an unlocked device.
   */
  async setPatterns(changes: SecretFilesChanges): Promise<VaultSecretsStatus> {
    const vaultPath = this.vaultPath();
    const lines = [
      "# The secret files of this vault: Eva encrypts each one. Settings writes this file.",
      "# A line adds a pattern, in .gitignore syntax. A line with ! turns a default off.",
      ...changes.added.map((pattern) => pattern.trim()).filter((pattern) => pattern !== "" && !pattern.startsWith("!")),
      ...changes.off.filter((pattern) => defaultSecretPatterns.includes(pattern)).map((pattern) => `!${pattern}`),
    ];
    await this.options.vault.exclusive(() => {
      writeFileAtomic(join(vaultPath, secretFilesPath), `${lines.join("\n")}\n`);
    });
    await this.options.vault.save();
    return this.status(null, null);
  }

  /** Signs every removal that waits, decrypts the files that they freed, and saves. Gives those paths. */
  async confirmRemovals(deviceToken: string | null, secret: string | null): Promise<string[]> {
    const unlocked = this.options.keys.keyFor(deviceToken, secret);
    const vaultPath = this.vaultPath();
    const decrypted = await this.options.vault.exclusive(() => {
      const secrets = this.secrets();
      const { key, keyChanged, machine, input } = secrets.inputs();
      if (key === null || keyChanged) throw new EvaError("vault_locked", "Confirm the vault's key first.");
      const before = activeSecretPatterns(input).active;
      const state = signedPayload(
        input,
        Math.max(machine.sequence, input.signed?.sequence ?? 0) + 1,
        keyFingerprint(key),
      );
      writeSignedState(vaultPath, state, unlocked);
      secrets.acceptSequence(state.sequence);
      const after = activeSecretPatterns({ ...input, signed: state }).active;
      const removed = before.filter((pattern) => !after.includes(pattern));
      return decryptRemovedFiles(vaultPath, new SecretMatcher(removed), new SecretMatcher(after), unlocked);
    });
    await this.options.vault.save();
    return decrypted;
  }

  /** Wraps the same keys with a new password. No file changes. */
  async changePassword(deviceToken: string | null, secret: string | null, password: string): Promise<void> {
    const unlocked = this.options.keys.keyFor(deviceToken, secret);
    const vaultPath = this.vaultPath();
    const rewrapped = await rewrapVaultKey(this.currentKey(vaultPath), unlocked, password, this.options.cost);
    await this.options.vault.exclusive(() => {
      writeVaultKey(vaultPath, rewrapped);
    });
    await this.options.vault.save();
  }

  /**
   * Makes new keys, encrypts every encrypted file again to them, and signs the record again, for
   * when the old password leaked. Every device locks: the old key opens nothing any more.
   */
  async newKey(deviceToken: string | null, secret: string | null, password: string): Promise<void> {
    const unlocked = this.options.keys.keyFor(deviceToken, secret);
    const vaultPath = this.vaultPath();
    const next = await createVaultKey(password, this.options.cost);
    const nextUnlocked = await unlockVaultKey(next, password);
    await this.options.vault.exclusive(() => {
      const secrets = this.secrets();
      const { machine, input } = secrets.inputs();
      encryptAgain(vaultPath, unlocked, next);
      writeVaultKey(vaultPath, next);
      secrets.pinKey(keyFingerprint(next));
      if (input.signed !== null) {
        const sequence = Math.max(machine.sequence, input.signed.sequence) + 1;
        const state = { ...input.signed, sequence, fingerprint: keyFingerprint(next) };
        writeSignedState(vaultPath, state, nextUnlocked);
        secrets.acceptSequence(sequence);
      }
    });
    this.options.keys.lockAll();
    await this.options.vault.save();
  }

  /** Pins a key that changed on another machine. The device must have unlocked that key here. */
  async acceptKey(deviceToken: string | null, secret: string | null): Promise<void> {
    this.options.keys.keyFor(deviceToken, secret);
    const key = this.currentKey(this.vaultPath());
    await this.options.vault.exclusive(() => {
      this.secrets().pinKey(keyFingerprint(key));
    });
    await this.options.vault.save();
  }

  private currentKey(vaultPath: string): NonNullable<ReturnType<typeof readVaultKey>> {
    const key = readVaultKey(vaultPath);
    if (key === null) throw new EvaError("vault_key_missing", "This vault has no password yet. Set one in Settings.");
    return key;
  }

  private vaultPath(): string {
    const path = this.options.vaultPath();
    if (path === null) throw new EvaError("vault_not_found", "Eva has no vault yet.");
    return path;
  }

  private secrets(): VaultSecrets {
    const secrets = this.options.secrets();
    if (secrets === null) throw new EvaError("vault_not_found", "Eva has no vault yet.");
    return secrets;
  }
}
