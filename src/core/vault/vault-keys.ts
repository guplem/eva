/**
 * The unlocked vault keys (#707). Only the person's own device decrypts: an agent runs as the same
 * user as Eva, and can read every file of the instance, the local API token included. So:
 * - a request with the local API token has no device token, and never unlocks or decrypts;
 * - each unlocked key lives in memory only, for one device, for 8 hours, and a restart forgets it;
 * - each unlock also gives the page a secret that it keeps in memory and sends with each request,
 *   so a device cookie that an agent copies from the disk is not enough;
 * - each use checks that the device is still allowed.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EvaError, isEvaError } from "../../shared/errors.ts";
import { readVaultKey } from "./secret-state.ts";
import { unlockVaultKey, type UnlockedVaultKey } from "./vault-crypto.ts";

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
  readonly secretHash: Buffer;
  readonly until: number;
}

export class VaultKeys {
  private readonly options: VaultKeysOptions;
  /** By the hash of the device token, so the token itself never sits in this map. */
  private readonly unlocked: Map<string, Unlocked>;
  private readonly failures: Map<string, number[]>;

  constructor(options: VaultKeysOptions) {
    this.options = options;
    this.unlocked = new Map();
    this.failures = new Map();
  }

  /**
   * Unlocks the vault's key for this device, and gives the secret that the page must send with each
   * request. Throws `vault_locked` for a request with no device token.
   */
  async unlock(deviceToken: string | null, password: string): Promise<string> {
    const device = this.device(deviceToken);
    const now = this.options.now().getTime();
    const recent = (this.failures.get(device) ?? []).filter((at) => now - at < failedTriesWindowMs);
    if (recent.length >= failedTriesAllowed)
      throw new EvaError("rate_limited", "Too many wrong passwords. Try again in 15 minutes.");
    const vaultPath = this.options.vaultPath();
    const file = vaultPath === null ? null : readVaultKey(vaultPath);
    if (file === null) throw new EvaError("vault_key_missing", "This vault has no password yet. Set one in Settings.");
    let key: UnlockedVaultKey;
    try {
      key = await unlockVaultKey(file, password);
    } catch (error) {
      if (isEvaError(error, "vault_password_wrong")) this.failures.set(device, [...recent, now]);
      throw error;
    }
    this.failures.delete(device);
    const secret = randomBytes(32).toString("base64url");
    this.unlocked.set(device, { key, secretHash: hashOf(secret), until: now + unlockedForMs });
    return secret;
  }

  /** Forgets this device's key at once. */
  lock(deviceToken: string | null): void {
    if (deviceToken !== null) this.unlocked.delete(hashText(deviceToken));
  }

  isUnlocked(deviceToken: string | null, secret: string | null): boolean {
    try {
      this.keyFor(deviceToken, secret);
      return true;
    } catch {
      return false;
    }
  }

  /** The unlocked key of this device, or `vault_locked`. */
  keyFor(deviceToken: string | null, secret: string | null): UnlockedVaultKey {
    const locked = (): EvaError => new EvaError("vault_locked", "Type the vault password on this device first.");
    if (deviceToken === null || secret === null) throw locked();
    const device = hashText(deviceToken);
    const entry = this.unlocked.get(device);
    if (entry === undefined) throw locked();
    if (entry.until <= this.options.now().getTime() || !this.options.isDeviceValid(deviceToken)) {
      this.unlocked.delete(device);
      throw locked();
    }
    if (!timingSafeEqual(entry.secretHash, hashOf(secret))) throw locked();
    return entry.key;
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
