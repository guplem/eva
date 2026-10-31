/**
 * What the person does with the vault's encryption (#707): set the password, unlock and lock a
 * device, read and save an encrypted file, change the patterns, confirm a removal, change the
 * password, make a new key, and accept a key that changed on another machine. Each change of the
 * vault runs between two steps of the vault sync, so it never races a commit.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import {
  decryptFiles,
  encryptAgain,
  filesFreedBy,
  readEncryptedFile,
  saveEncryptedFile,
  type OpenedFile,
} from "./encrypted-files.ts";
import { defaultSecretPatterns, SecretMatcher, secretFilesPath, type SecretFilesChanges } from "./secret-files.ts";
import { activeSecretPatterns, addedBack, signedPayload } from "./secret-policy.ts";
import { readVaultKey, vaultKeyPath, writeSignedState, writeVaultKey } from "./secret-state.ts";
import {
  createVaultKey,
  keyFingerprint,
  rewrapVaultKey,
  unlockVaultKey,
  type UnlockedVaultKey,
} from "./vault-crypto.ts";
import type { VaultKeys } from "./vault-keys.ts";
import type { VaultSecrets } from "./vault-secrets.ts";

/** The steps of the vault sync that a change needs. */
export interface VaultSteps {
  /** Runs the work between two sync steps. */
  exclusive<Result>(work: () => Result): Promise<Result>;
  /** Its status tells whether the remote answered. */
  pull(): Promise<{ readonly status: string }>;
  /** Encrypts each plain secret file now, even with the vault sync off. */
  encryptSecrets(): Promise<void>;
  /** Commits and pushes, when the vault sync is on. */
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
  /** The encrypted files that a confirmation of every waiting removal would decrypt. */
  readonly waitingFiles: readonly string[];
}

/** What the person saw before a confirmation: only these patterns stop, and only if these files are the ones. */
export interface ConfirmedRemoval {
  readonly patterns: readonly string[];
  readonly files: readonly string[];
}

export class VaultEncryption {
  private readonly options: VaultEncryptionOptions;

  constructor(options: VaultEncryptionOptions) {
    this.options = options;
  }

  status(deviceToken: string | null, secret: string | null): VaultSecretsStatus {
    const secrets = this.options.secrets();
    if (secrets === null)
      return {
        hasKey: false,
        keyChanged: false,
        unlocked: false,
        defaults: [],
        added: [],
        waiting: [],
        waitingFiles: [],
      };
    const { key, keyChanged, input } = secrets.inputs();
    const { active, waiting } = activeSecretPatterns(input);
    const off = new Set(input.changes.off);
    return {
      hasKey: key !== null,
      keyChanged,
      unlocked: this.options.keys.isUnlocked(deviceToken, secret),
      defaults: defaultSecretPatterns.map((pattern) => ({ pattern, on: !off.has(pattern) })),
      added: input.changes.added,
      waiting,
      waitingFiles: waiting.length === 0 ? [] : this.freedFiles(active, waiting),
    };
  }

  /** Makes the vault's key. Only after a pull, so two machines never make two keys. */
  async setPassword(deviceToken: string | null, password: string): Promise<void> {
    // The token alone must not choose the password: an agent can read the token.
    this.options.keys.checkDevice(deviceToken);
    const vaultPath = this.vaultPath();
    const file = await createVaultKey(password, this.options.cost);
    // A key made with no word from the remote could meet a key that another computer made meanwhile.
    const pulled = await this.options.vault.pull();
    if (pulled.status === "offline" || pulled.status === "error" || pulled.status === "conflict")
      throw new EvaError(
        "vault_key_invalid",
        "Eva cannot sync the vault now, so she makes no key: two computers could make two. Try again when the sync works.",
      );
    await this.options.vault.exclusive(() => {
      // A broken file, or one from a newer Eva, still holds the only copy of a key: never write over it.
      if (existsSync(join(vaultPath, vaultKeyPath)))
        throw new EvaError(
          "vault_key_invalid",
          readVaultKey(vaultPath) === null
            ? "The vault's key file is broken, or a newer Eva wrote it. Restore .eva/vault-key.json from an older commit, or update Eva."
            : "This vault has a password already. Change it in Settings.",
        );
      // A key that went away is a key that git still holds: a second one would split the files in two.
      if (this.secrets().inputs().machine.fingerprint !== null)
        throw new EvaError(
          "vault_key_invalid",
          "The vault's key file is gone, but this computer used a key before. Restore .eva/vault-key.json from an older commit.",
        );
      writeVaultKey(vaultPath, file);
      this.secrets().pinKey(keyFingerprint(file));
    });
    await this.persist();
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
    const vaultPath = this.vaultPath();
    await this.options.vault.exclusive(() => {
      // The unlocked key is the vault's key now, and the machine trusts it: so the text goes to the person's key.
      this.options.keys.keyFor(deviceToken, secret);
      this.refuseChangedKey();
      const key = this.currentKey(vaultPath);
      saveEncryptedFile(vaultPath, relativePath, text, version, key);
    });
    await this.persist();
  }

  /**
   * Writes the person's patterns. An added pattern encrypts its files at the save that follows. A
   * default turned off, or a pattern taken out, waits for a confirmation from an unlocked device.
   */
  async setPatterns(deviceToken: string | null, secret: string | null, changes: SecretFilesChanges): Promise<void> {
    const vaultPath = this.vaultPath();
    const added = changes.added
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern !== "" && !pattern.startsWith("!"));
    const off = changes.off.filter((pattern) => defaultSecretPatterns.includes(pattern));
    const lines = [
      "# The secret files of this vault: Eva encrypts each one. Settings writes this file.",
      "# A line adds a pattern, in .gitignore syntax. A line with ! turns a default off.",
      ...added,
      ...off.map((pattern) => `!${pattern}`),
    ];
    await this.options.vault.exclusive(() => {
      const secrets = this.secrets();
      const { key, keyChanged, machine, input } = secrets.inputs();
      const next = { ...input, changes: { added, off } };
      // An agent could drop a pattern that only the file holds, so an unlocked device signs the new list.
      // A pattern that a signed removal took out comes back only that way, or the old record drops it again.
      const unlocked = this.unlockedOrNull(deviceToken, secret);
      if (unlocked === null && addedBack(next).length > 0)
        throw new EvaError("vault_locked", "Unlock this tab to add back a pattern that you took out before.");
      writeFileAtomic(join(vaultPath, secretFilesPath), `${lines.join("\n")}\n`);
      if (unlocked === null || key === null || keyChanged) return;
      const sequence = Math.max(machine.sequence, input.signed?.sequence ?? 0) + 1;
      const state = signedPayload(
        next,
        // What applies now under the old record: a confirmed removal stays confirmed, and one that waits still waits.
        activeSecretPatterns(next).active,
        sequence,
        keyFingerprint(key),
      );
      writeSignedState(vaultPath, state, unlocked);
      secrets.acceptSequence(sequence);
    });
    await this.persist();
  }

  /**
   * Signs the removals that the person saw, decrypts the files that they free, and saves. Refuses
   * when the files are not the ones that the person saw. Gives the decrypted paths.
   */
  async confirmRemovals(deviceToken: string | null, secret: string | null, seen: ConfirmedRemoval): Promise<string[]> {
    const vaultPath = this.vaultPath();
    const decrypted = await this.options.vault.exclusive(() => {
      const unlocked = this.options.keys.keyFor(deviceToken, secret);
      this.refuseChangedKey();
      const secrets = this.secrets();
      const { key, machine, input } = secrets.inputs();
      if (key === null) throw new EvaError("vault_key_missing", "This vault has no password yet. Set one in Settings.");
      const { active, waiting } = activeSecretPatterns(input);
      const patterns = seen.patterns.filter((pattern) => waiting.includes(pattern));
      const keep = active.filter((pattern) => !patterns.includes(pattern));
      const files = patterns.length === 0 ? [] : this.freedFiles(keep, patterns);
      if ([...files].sort().join("\n") !== [...seen.files].sort().join("\n"))
        throw new EvaError("file_changed", "The files changed since you looked. Look at the list again.");
      // The files first: a file that does not decrypt leaves the record, and so every file, as it was.
      decryptFiles(vaultPath, files, unlocked);
      const sequence = Math.max(machine.sequence, input.signed?.sequence ?? 0) + 1;
      writeSignedState(vaultPath, signedPayload(input, keep, sequence, keyFingerprint(key)), unlocked);
      secrets.acceptSequence(sequence);
      return files;
    });
    await this.persist();
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
    await this.persist();
  }

  /**
   * Makes new keys, encrypts every encrypted file again to them, and signs the record again, for
   * when the old password leaked. Every device locks: the old key opens nothing any more.
   */
  async newKey(deviceToken: string | null, secret: string | null, password: string): Promise<void> {
    this.options.keys.keyFor(deviceToken, secret);
    const vaultPath = this.vaultPath();
    const next = await createVaultKey(password, this.options.cost);
    const nextUnlocked = await unlockVaultKey(next, password);
    // Another machine may have pushed a file on the old key: it must move to the new key too.
    await this.options.vault.pull();
    await this.options.vault.exclusive(() => {
      const unlocked = this.options.keys.keyFor(deviceToken, secret);
      this.refuseChangedKey();
      const secrets = this.secrets();
      const { machine, input } = secrets.inputs();
      // The new key file first: a stop halfway leaves files on the old key, which git still holds.
      const { unreadable } = encryptAgain(vaultPath, unlocked, next, () => writeVaultKey(vaultPath, next));
      if (unreadable.length > 0)
        throw new EvaError(
          "vault_file_unreadable",
          `The vault's key does not open ${unreadable.join(", ")}, so Eva made no new key. Restore each file from an older commit, or delete it.`,
        );
      secrets.pinKey(keyFingerprint(next));
      if (input.signed !== null) {
        const sequence = Math.max(machine.sequence, input.signed.sequence) + 1;
        const state = { ...input.signed, sequence, fingerprint: keyFingerprint(next) };
        writeSignedState(vaultPath, state, nextUnlocked);
        secrets.acceptSequence(sequence);
      }
    });
    this.options.keys.lockAll();
    await this.persist();
  }

  /** Pins a key that changed on another machine. The device must have unlocked that key here. */
  async acceptKey(deviceToken: string | null, secret: string | null): Promise<void> {
    this.options.keys.keyFor(deviceToken, secret);
    const key = this.currentKey(this.vaultPath());
    await this.options.vault.exclusive(() => {
      this.secrets().pinKey(keyFingerprint(key));
    });
    await this.persist();
  }

  /** The encrypted files that the `removed` patterns cover and that no pattern of `keep` covers. */
  private freedFiles(keep: readonly string[], removed: readonly string[]): string[] {
    const after = keep.filter((pattern) => !removed.includes(pattern));
    return filesFreedBy(this.vaultPath(), new SecretMatcher(removed), new SecretMatcher(after));
  }

  /** The unlocked key of this device, or null for a request that has none. */
  private unlockedOrNull(deviceToken: string | null, secret: string | null): UnlockedVaultKey | null {
    try {
      return this.options.keys.keyFor(deviceToken, secret);
    } catch {
      return null;
    }
  }

  /** A key that changed and that the person did not confirm here may be an agent's: give it nothing. */
  private refuseChangedKey(): void {
    if (this.secrets().inputs().keyChanged)
      throw new EvaError("vault_key_invalid", "The vault's key changed. Confirm it in Settings first.");
  }
  /** Encrypts the files that a change made secret at once, then commits and pushes when sync is on. */
  private async persist(): Promise<void> {
    await this.options.vault.encryptSecrets();
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
