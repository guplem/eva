/**
 * The unlocked vault keys (#707). Only the person's own device decrypts: an agent runs as the same
 * user as Eva, and can read every file of the instance, the local API token included. So:
 * - a request with the local API token has no device token, and never unlocks or decrypts;
 * - each unlocked key lives in memory only, for one device, for 8 hours, and a restart forgets it;
 * - each unlock also gives the page a secret that its tab keeps and sends with each request, so a
 *   device cookie that an agent copies from the disk is not enough;
 * - each use checks that the device is still allowed, and that the vault still holds the same key;
 * - the wrong tries of every device count together, since the token can make new devices.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { readVaultKey } from "./secret-state.ts";
import { keyFingerprint, unlockVaultKey, type UnlockedVaultKey } from "./vault-crypto.ts";

const unlockedForMs = 8 * 60 * 60_000;
const failedTriesAllowed = 5;
const failedTriesWindowMs = 15 * 60_000;

export interface VaultKeysOptions {
  /** The vault, read at each use: the person can set it up after Eva starts. */
  readonly vaultPath: () => string | null;
  readonly now: () => Date;
  /** False for a device that the person forgot, or a token that Eva does not know. */
  readonly isDeviceValid: (deviceToken: string) => boolean;
}

interface Unlocked {
  readonly key: UnlockedVaultKey;
  /** The key file that the password opened: a key that changes after the unlock opens nothing. */
  readonly fingerprint: string;
  /** One for each tab of the device that typed the password. */
  readonly secretHashes: readonly Buffer[];
  readonly until: number;
}

export class VaultKeys {
  private readonly options: VaultKeysOptions;
  /** By the hash of the device token, so the token itself never sits in this map. */
  private readonly unlocked: Map<string, Unlocked>;
  private failures: number[];
  /** One scrypt at a time: each one holds about 128 MB. */
  private queue: Promise<unknown>;

  constructor(options: VaultKeysOptions) {
    this.options = options;
    this.unlocked = new Map();
    this.failures = [];
    this.queue = Promise.resolve();
  }

  /**
   * Unlocks the vault's key for this device, and gives the secret that the page must send with each
   * request. Throws `vault_locked` for a request with no device token.
   */
  unlock(deviceToken: string | null, password: string): Promise<string> {
    const device = this.device(deviceToken);
    const run = this.queue.then(() => this.unlockNow(device, password));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Throws `vault_locked` for a request with no device token, or for a forgotten device. */
  checkDevice(deviceToken: string | null): void {
    this.device(deviceToken);
  }

  /** Forgets this device's key at once, for each of its tabs. */
  lock(deviceToken: string | null): void {
    if (deviceToken !== null) this.unlocked.delete(hashText(deviceToken));
  }

  /** Forgets every device's key, such as after a new key: the old one opens nothing any more. */
  lockAll(): void {
    this.unlocked.clear();
  }

  isUnlocked(deviceToken: string | null, secret: string | null): boolean {
    try {
      this.keyFor(deviceToken, secret);
      return true;
    } catch {
      return false;
    }
  }

  /** The unlocked key of this device, or `vault_locked`. The key is always the one in the vault now. */
  keyFor(deviceToken: string | null, secret: string | null): UnlockedVaultKey {
    const locked = (): EvaError => new EvaError("vault_locked", "Type the vault password on this device first.");
    this.forgetExpired();
    if (deviceToken === null || secret === null) throw locked();
    const device = hashText(deviceToken);
    const entry = this.unlocked.get(device);
    if (entry === undefined) throw locked();
    if (!this.options.isDeviceValid(deviceToken) || entry.fingerprint !== this.currentFingerprint()) {
      this.unlocked.delete(device);
      throw locked();
    }
    const asked = hashOf(secret);
    if (!entry.secretHashes.some((hash) => timingSafeEqual(hash, asked))) throw locked();
    return entry.key;
  }

  private async unlockNow(device: string, password: string): Promise<string> {
    const now = this.options.now().getTime();
    this.failures = this.failures.filter((at) => now - at < failedTriesWindowMs);
    if (this.failures.length >= failedTriesAllowed)
      throw new EvaError("rate_limited", "Too many wrong passwords. Try again in 15 minutes.");
    const vaultPath = this.options.vaultPath();
    const file = vaultPath === null ? null : readVaultKey(vaultPath);
    if (file === null) throw new EvaError("vault_key_missing", "This vault has no password yet. Set one in Settings.");
    let key: UnlockedVaultKey;
    try {
      key = await unlockVaultKey(file, password);
    } catch (error) {
      if (isEvaError(error, "vault_password_wrong")) this.failures.push(now);
      throw error;
    }
    const secret = randomBytes(32).toString("base64url");
    const fingerprint = keyFingerprint(file);
    const kept = this.unlocked.get(device);
    const tabs = kept?.fingerprint === fingerprint && kept.until > now ? kept.secretHashes : [];
    this.unlocked.set(device, {
      key,
      fingerprint,
      secretHashes: [...tabs, hashOf(secret)],
      until: now + unlockedForMs,
    });
    return secret;
  }

  /** An expired key leaves memory at the next use of any device, not only at the next use of its own. */
  private forgetExpired(): void {
    const now = this.options.now().getTime();
    for (const [device, entry] of this.unlocked) if (entry.until <= now) this.unlocked.delete(device);
  }

  private currentFingerprint(): string | null {
    const vaultPath = this.options.vaultPath();
    const file = vaultPath === null ? null : readVaultKey(vaultPath);
    return file === null ? null : keyFingerprint(file);
  }

  private device(deviceToken: string | null): string {
    if (deviceToken === null || !this.options.isDeviceValid(deviceToken))
      throw new EvaError("vault_locked", "Only a device that you allowed can open an encrypted file.");
    return hashText(deviceToken);
  }
}

function hashOf(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

function hashText(text: string): string {
  return hashOf(text).toString("hex");
}
