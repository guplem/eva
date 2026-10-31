import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultKey } from "../../../../src/core/vault/vault-crypto.ts";
import { writeVaultKey } from "../../../../src/core/vault/secret-state.ts";
import { VaultKeys } from "../../../../src/core/vault/vault-keys.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let root: string;
let vault: string;
let now: number;
let validDevices: Set<string>;
const password = "correct horse battery";

function keys(): VaultKeys {
  return new VaultKeys({
    vaultPath: () => vault,
    now: () => new Date(now),
    isDeviceValid: (token) => validDevices.has(token),
  });
}

async function failure(work: () => unknown): Promise<unknown> {
  try {
    await work();
    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "eva-vault-keys-"));
  vault = join(root, "vault");
  mkdirSync(join(vault, ".eva"), { recursive: true });
  writeVaultKey(vault, await createVaultKey(password, { logN: 10 }));
  now = Date.parse("2026-10-31T10:00:00Z");
  validDevices = new Set(["phone-token", "laptop-token"]);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("unlocked vault keys (#707)", () => {
  test("a device that typed the password gets the key, with the secret that its page keeps", async () => {
    const store = keys();
    const secret = await store.unlock("phone-token", password);
    expect(store.keyFor("phone-token", secret)).toBeDefined();
    expect(store.isUnlocked("phone-token", secret)).toBe(true);
    // The device cookie alone, such as one that an agent copied from the disk, is not enough.
    expect(isEvaError(await failure(() => store.keyFor("phone-token", "another secret")), "vault_locked")).toBe(true);
    // Another device did not type the password.
    expect(isEvaError(await failure(() => store.keyFor("laptop-token", secret)), "vault_locked")).toBe(true);
  });

  test("a request with the local API token never decrypts", async () => {
    const store = keys();
    expect(isEvaError(await failure(() => store.unlock(null, password)), "vault_locked")).toBe(true);
    expect(isEvaError(await failure(() => store.keyFor(null, "x")), "vault_locked")).toBe(true);
  });

  test("the key goes after 8 hours, after Lock, and when the device is forgotten", async () => {
    const store = keys();
    const secret = await store.unlock("phone-token", password);
    now += 8 * 60 * 60_000 - 1;
    expect(store.isUnlocked("phone-token", secret)).toBe(true);
    now += 1;
    expect(store.isUnlocked("phone-token", secret)).toBe(false);
    const again = await store.unlock("phone-token", password);
    store.lock("phone-token");
    expect(store.isUnlocked("phone-token", again)).toBe(false);
    const third = await store.unlock("phone-token", password);
    validDevices.delete("phone-token");
    expect(store.isUnlocked("phone-token", third)).toBe(false);
  });

  test("a wrong password is refused, and many wrong tries wait", async () => {
    const store = keys();
    expect(
      isEvaError(await failure(() => store.unlock("phone-token", "a wrong password!")), "vault_password_wrong"),
    ).toBe(true);
    for (let attempt = 0; attempt < 4; attempt += 1)
      await failure(() => store.unlock("phone-token", "wrong again 123"));
    expect(isEvaError(await failure(() => store.unlock("phone-token", password)), "rate_limited")).toBe(true);
    now += 15 * 60_000;
    expect(await store.unlock("phone-token", password)).toBeString();
  });

  test("a vault with no key has nothing to unlock", async () => {
    rmSync(join(vault, ".eva", "vault-key.json"));
    expect(isEvaError(await failure(() => keys().unlock("phone-token", password)), "vault_key_missing")).toBe(true);
  });
});
