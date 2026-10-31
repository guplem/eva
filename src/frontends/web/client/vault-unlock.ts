/**
 * The secret that an unlock gives this tab (#707). The core decrypts only for a request that holds
 * it, so a device cookie that an agent copies from the disk decrypts nothing. The tab keeps it in
 * `sessionStorage`: it goes when the tab closes, and no other tab or program sees it.
 */
import { unlockHeader } from "../../../shared/unlock-header.ts";

const storageKey = "eva-vault-unlock";

/** A store that can fail, as a private window or a full disk makes it. */
export interface UnlockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): UnlockStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function unlockSecret(store: UnlockStorage | null = storage()): string | null {
  try {
    return store?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}

export function keepUnlockSecret(secret: string, store: UnlockStorage | null = storage()): void {
  try {
    store?.setItem(storageKey, secret);
  } catch {
    // The tab then asks for the password again: never a failure of the unlock itself.
  }
}

export function forgetUnlockSecret(store: UnlockStorage | null = storage()): void {
  try {
    store?.removeItem(storageKey);
  } catch {
    // Nothing to do: the core forgets the key at the lock.
  }
}

/** The header of each request that may decrypt. Empty while this tab holds no secret. */
export function unlockHeaders(store: UnlockStorage | null = storage()): Record<string, string> {
  const secret = unlockSecret(store);
  return secret === null ? {} : { [unlockHeader]: secret };
}
