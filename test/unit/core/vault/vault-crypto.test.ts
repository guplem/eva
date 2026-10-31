import { describe, expect, test } from "bun:test";
import {
  createVaultKey,
  decryptFile,
  encryptedFileLine,
  encryptedFingerprint,
  encryptedState,
  encryptFile,
  hasEncryptedShape,
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
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const plainText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function keyFile(): Promise<VaultKeyFile> {
  return createVaultKey(password, cost);
}

async function failure(work: () => unknown): Promise<unknown> {
  try {
    await work();
    return null;
  } catch (error) {
    return error;
  }
}

describe("vault keys (#707)", () => {
  test("a key file holds both public keys and the wrapped private keys, never the password", async () => {
    const file = await keyFile();
    expect(file.version).toBe(1);
    expect(file.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(file.signingKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.stringify(file)).not.toContain(password);
    expect(file.kdf).toMatchObject({ name: "scrypt", logN: 10, r: 8, p: 1 });
  });

  test("a short password is refused, since a thief can try passwords offline", async () => {
    expect(isEvaError(await failure(() => createVaultKey("short", cost)), "vault_password_invalid")).toBe(true);
  });

  test("the right password unlocks the key, and a wrong one is refused", async () => {
    const file = await keyFile();
    expect(await unlockVaultKey(file, password)).toBeDefined();
    expect(isEvaError(await failure(() => unlockVaultKey(file, "a wrong password here")), "vault_password_wrong")).toBe(
      true,
    );
  });

  test("a key file with a swapped public key, or a huge cost, does not unlock", async () => {
    const file = await keyFile();
    const other = await keyFile();
    for (const changed of [
      { ...file, publicKey: other.publicKey },
      { ...file, signingKey: other.signingKey },
      { ...file, kdf: { ...file.kdf, logN: 11 } },
    ])
      expect(isEvaError(await failure(() => unlockVaultKey(changed, password)))).toBe(true);
    for (const broken of [
      { ...file, kdf: { ...file.kdf, logN: 40 } },
      { ...file, publicKey: "short" },
      { ...file, wrappedPrivateKey: "" },
    ])
      expect(isEvaError(await failure(() => unlockVaultKey(broken, password)), "vault_key_invalid")).toBe(true);
  });

  test("a file encrypts with the public key alone, and decrypts with the unlocked key", async () => {
    const file = await keyFile();
    const plain = text("API_KEY=sk-example-0123456789\n");
    const encrypted = encryptFile(plain, file);
    expect(encryptedState(encrypted)).toBe("encrypted");
    expect(encryptedFingerprint(encrypted)).toBe(keyFingerprint(file));
    expect(hasEncryptedShape(encrypted)).toBe(true);
    expect(plainText(encrypted)).toStartWith(`${encryptedFileLine}\n`);
    expect(plainText(encrypted)).not.toContain("sk-example");
    expect(decryptFile(encrypted, await unlockVaultKey(file, password))).toEqual(plain);
    // The same text gives other bytes each time, so Eva never encrypts an encrypted file again.
    expect(encryptFile(plain, file)).not.toEqual(encrypted);
  });

  test("a changed, cut or extended encrypted file does not decrypt", async () => {
    const file = await keyFile();
    const encrypted = plainText(encryptFile(text("secret"), file));
    const lines = encrypted.split("\n");
    const flipped = lines.map((line, index) =>
      index === 2 ? line.slice(0, 5) + (line[5] === "A" ? "B" : "A") + line.slice(6) : line,
    );
    const unlocked = await unlockVaultKey(file, password);
    for (const bad of [flipped.join("\n"), encrypted.slice(0, 120), `${encrypted}TOKEN=1\n`]) {
      expect(isEvaError(await failure(() => decryptFile(text(bad), unlocked)), "vault_file_unreadable")).toBe(true);
    }
    expect(hasEncryptedShape(text(`${encrypted}TOKEN=1\n`))).toBe(false);
  });

  test("a file that claims another key, by its header, does not decrypt", async () => {
    const file = await keyFile();
    const encrypted = plainText(encryptFile(text("secret"), file));
    const claimed = encrypted.replace(keyFingerprint(file), "0123456789abcdef");
    const caught = await failure(async () => decryptFile(text(claimed), await unlockVaultKey(file, password)));
    expect(isEvaError(caught, "vault_file_unreadable")).toBe(true);
  });

  test("Windows line ends and a BOM keep a file encrypted, and a newer format is never touched", async () => {
    const file = await keyFile();
    const encrypted = plainText(encryptFile(text("secret"), file));
    const bom = String.fromCharCode(0xfeff);
    expect(encryptedState(text(`${bom}${encrypted.replaceAll("\n", "\r\n")}`))).toBe("encrypted");
    expect(encryptedState(text(`${encryptedFileLine}\neva-encrypted-v2 0123456789abcdef\nxyz\n`))).toBe("newer");
    expect(isEncryptedFile(text(`${encryptedFileLine}\neva-encrypted-v2\n`))).toBe(true);
  });

  test("a plain file, even one that names Eva's line later, is not an encrypted file", () => {
    expect(isEncryptedFile(text("TOKEN=1\n"))).toBe(false);
    expect(isEncryptedFile(text(`note\n${encryptedFileLine}\n`))).toBe(false);
    expect(isEncryptedFile(text(`${encryptedFileLine}\nsomething else\n`))).toBe(false);
  });

  test("a new password wraps the same private keys again, so every file still opens", async () => {
    const file = await keyFile();
    const encrypted = encryptFile(text("secret"), file);
    const moved = await rewrapVaultKey(file, await unlockVaultKey(file, password), "a brand new password", cost);
    expect(keyFingerprint(moved)).toBe(keyFingerprint(file));
    const unlocked = await unlockVaultKey(moved, "a brand new password");
    expect(plainText(decryptFile(encrypted, unlocked))).toBe("secret");
  });

  test("each key has its own fingerprint, which covers both public keys", async () => {
    const file = await keyFile();
    const other = await keyFile();
    expect(keyFingerprint(file)).not.toBe(keyFingerprint(other));
    expect(keyFingerprint(file)).toMatch(/^[0-9a-f]{16}$/);
    // An agent that swaps only the signing key must not keep the fingerprint.
    expect(keyFingerprint({ ...file, signingKey: other.signingKey })).not.toBe(keyFingerprint(file));
  });

  test("an unlocked key signs a record, and any machine checks it with the plain public key", async () => {
    const file = await keyFile();
    const record = '{"removed":["*.key"]}';
    const signature = signRecord(record, await unlockVaultKey(file, password));
    expect(verifyRecord(record, signature, file)).toBe(true);
    expect(verifyRecord('{"removed":["*.pem"]}', signature, file)).toBe(false);
    expect(verifyRecord(record, signature, await keyFile())).toBe(false);
    expect(verifyRecord(record, "not base64 !", file)).toBe(false);
  });
});
