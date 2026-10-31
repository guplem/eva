import { describe, expect, test } from "bun:test";
import {
  createVaultKey,
  decryptFile,
  encryptedFileLine,
  encryptFile,
  isEncryptedFile,
  keyFingerprint,
  rewrapVaultKey,
  signRecord,
  unlockVaultKey,
  verifyRecord,
  type VaultKeyFile,
} from "../../../../src/core/vault/vault-crypto.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

// A low cost keeps the tests fast. Eva's own cost is much higher.
const cost = { logN: 10 };
const password = "correct horse battery";

function keyFile(): VaultKeyFile {
  return createVaultKey(password, cost);
}

describe("vault keys (#707)", () => {
  test("a key file holds the public key and a wrapped private key, never the password", () => {
    const file = keyFile();
    expect(file.version).toBe(1);
    expect(file.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.stringify(file)).not.toContain(password);
    expect(file.kdf).toMatchObject({ name: "scrypt", logN: 10, r: 8, p: 1 });
  });

  test("a short password is refused, since a thief can try passwords offline", () => {
    const caught = (() => {
      try {
        return createVaultKey("short", cost);
      } catch (error) {
        return error;
      }
    })();
    expect(isEvaError(caught, "vault_password_invalid")).toBe(true);
  });

  test("the right password unlocks the key, and a wrong one is refused", () => {
    const file = keyFile();
    expect(unlockVaultKey(file, password)).toBeDefined();
    const caught = (() => {
      try {
        return unlockVaultKey(file, "a wrong password here");
      } catch (error) {
        return error;
      }
    })();
    expect(isEvaError(caught, "vault_password_wrong")).toBe(true);
  });

  test("a file encrypts with the public key alone, and decrypts with the unlocked key", () => {
    const file = keyFile();
    const plain = new TextEncoder().encode("API_KEY=sk-example-0123456789\n");
    const encrypted = encryptFile(plain, file);
    expect(isEncryptedFile(encrypted)).toBe(true);
    expect(new TextDecoder().decode(encrypted)).toStartWith(`${encryptedFileLine}\n`);
    expect(new TextDecoder().decode(encrypted)).not.toContain("sk-example");
    expect(decryptFile(encrypted, unlockVaultKey(file, password))).toEqual(plain);
    // The same text gives other bytes each time, so a file shows no change only when it is not encrypted again.
    expect(encryptFile(plain, file)).not.toEqual(encrypted);
  });

  test("a changed or cut encrypted file does not decrypt", () => {
    const file = keyFile();
    const encrypted = encryptFile(new TextEncoder().encode("secret"), file);
    const text = new TextDecoder().decode(encrypted);
    const changed = new TextEncoder().encode(text.slice(0, -6) + (text.endsWith("A") ? "B" : "A") + text.slice(-5));
    for (const bad of [changed, encrypted.slice(0, 40)]) {
      const caught = (() => {
        try {
          return decryptFile(bad, unlockVaultKey(file, password));
        } catch (error) {
          return error;
        }
      })();
      expect(isEvaError(caught, "vault_file_unreadable")).toBe(true);
    }
  });

  test("a plain file, even one that names Eva's line later, is not an encrypted file", () => {
    expect(isEncryptedFile(new TextEncoder().encode("TOKEN=1\n"))).toBe(false);
    expect(isEncryptedFile(new TextEncoder().encode(`note\n${encryptedFileLine}\n`))).toBe(false);
  });

  test("a new password wraps the same private key again, so every file still opens", () => {
    const file = keyFile();
    const encrypted = encryptFile(new TextEncoder().encode("secret"), file);
    const moved = rewrapVaultKey(file, unlockVaultKey(file, password), "a brand new password", cost);
    expect(moved.publicKey).toBe(file.publicKey);
    expect(keyFingerprint(moved)).toBe(keyFingerprint(file));
    expect(new TextDecoder().decode(decryptFile(encrypted, unlockVaultKey(moved, "a brand new password")))).toBe(
      "secret",
    );
  });

  test("each key has its own fingerprint, which covers both public keys", () => {
    const file = keyFile();
    expect(keyFingerprint(file)).not.toBe(keyFingerprint(keyFile()));
    expect(keyFingerprint(file)).toMatch(/^[0-9a-f]{16}$/);
    // An agent that swaps only the signing key must not keep the fingerprint.
    expect(keyFingerprint({ ...file, signingKey: keyFile().signingKey })).not.toBe(keyFingerprint(file));
  });

  test("an unlocked key signs a record, and any machine checks it with the plain public key", () => {
    const file = keyFile();
    const record = '{"removed":["*.key"]}';
    const signature = signRecord(record, unlockVaultKey(file, password));
    expect(verifyRecord(record, signature, file)).toBe(true);
    expect(verifyRecord('{"removed":["*.pem"]}', signature, file)).toBe(false);
    expect(verifyRecord(record, signature, keyFile())).toBe(false);
    expect(verifyRecord(record, "not base64 !", file)).toBe(false);
  });
});
