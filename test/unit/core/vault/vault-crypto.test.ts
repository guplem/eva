import { describe, expect, test } from "bun:test";
import {
  chainTrusts,
  createVaultKey,
  decryptFile,
  encryptedFileLine,
  encryptedFingerprint,
  encryptedState,
  encryptFile,
  hasEncryptedShape,
  isEncryptedFile,
  keyFingerprint,
  nextVaultKey,
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
      // 2^19 rounds would hold 512 MB, and a long salt only costs time: a changed file asks for neither.
      { ...file, kdf: { ...file.kdf, logN: 19 } },
      { ...file, kdf: { ...file.kdf, salt: Buffer.alloc(65).toString("base64") } },
      { ...file, publicKey: "short" },
      { ...file, wrappedPrivateKey: "" },
    ])
      expect(isEvaError(await failure(() => unlockVaultKey(broken, password)), "vault_key_invalid")).toBe(true);
  });

  test("a file encrypts with the public key alone, and decrypts with the unlocked key", async () => {
    const file = await keyFile();
    const plain = text("API_KEY=sk-example-0123456789\n");
    const encrypted = encryptFile(plain, file, "deploy/id.key");
    expect(encryptedState(encrypted)).toBe("encrypted");
    expect(encryptedFingerprint(encrypted)).toBe(keyFingerprint(file));
    expect(hasEncryptedShape(encrypted)).toBe(true);
    expect(plainText(encrypted)).toStartWith(`${encryptedFileLine}\n`);
    expect(plainText(encrypted)).not.toContain("sk-example");
    expect(decryptFile(encrypted, await unlockVaultKey(file, password)).plain).toEqual(plain);
    // The same text gives other bytes each time, so Eva never encrypts an encrypted file again.
    expect(encryptFile(plain, file, "deploy/id.key")).not.toEqual(encrypted);
  });

  test("a changed, cut or extended encrypted file does not decrypt", async () => {
    const file = await keyFile();
    const encrypted = plainText(encryptFile(text("secret"), file, "deploy/id.key"));
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
    const encrypted = plainText(encryptFile(text("secret"), file, "deploy/id.key"));
    const claimed = encrypted.replace(keyFingerprint(file), "0123456789abcdef");
    const caught = await failure(async () => decryptFile(text(claimed), await unlockVaultKey(file, password)));
    expect(isEvaError(caught, "vault_file_unreadable")).toBe(true);
  });

  test("Windows line ends and a BOM keep a file encrypted, and a newer format is never touched", async () => {
    const file = await keyFile();
    const encrypted = plainText(encryptFile(text("secret"), file, "deploy/id.key"));
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

  test("a new password makes a new key, signed by the old one, so the old password opens nothing new (#775)", async () => {
    const file = await keyFile();
    const next = await nextVaultKey(file, await unlockVaultKey(file, password), "a brand new password", cost);
    expect(keyFingerprint(next)).not.toBe(keyFingerprint(file));
    expect(await failure(() => unlockVaultKey(next, password))).toMatchObject({ code: "vault_password_wrong" });
    const unlocked = await unlockVaultKey(next, "a brand new password");
    expect(plainText(decryptFile(encryptFile(text("secret"), next, "a.key"), unlocked).plain)).toBe("secret");
    // A computer that trusts the old key trusts the new one by its signature, with no question.
    expect(chainTrusts(next, keyFingerprint(file))).toBe(true);
    expect(chainTrusts(next, keyFingerprint(next))).toBe(false);
  });

  test("the new key keeps the older private keys, so the new password opens a file left on an old key (#775)", async () => {
    const file = await keyFile();
    // Another computer encrypted this file to the old key just before it learned of the new one.
    const late = encryptFile(text("late secret"), file, "deploy/late.key");
    const next = await nextVaultKey(file, await unlockVaultKey(file, password), "a brand new password", cost);
    const unlocked = await unlockVaultKey(next, "a brand new password");
    expect(plainText(decryptFile(late, unlocked).plain)).toBe("late secret");
    // The old password still opens only the old key, never a file on the new one.
    const fresh = encryptFile(text("fresh secret"), next, "deploy/fresh.key");
    const old = await unlockVaultKey(file, password);
    expect(await failure(() => decryptFile(fresh, old))).toMatchObject({ code: "vault_file_unreadable" });
  });

  test("a computer that missed several changes trusts the newest key through the whole chain (#775)", async () => {
    const first = await keyFile();
    const second = await nextVaultKey(first, await unlockVaultKey(first, password), "second password here", cost);
    const third = await nextVaultKey(
      second,
      await unlockVaultKey(second, "second password here"),
      "third password here",
      cost,
    );
    expect(chainTrusts(third, keyFingerprint(first))).toBe(true);
    expect(chainTrusts(third, keyFingerprint(second))).toBe(true);
  });

  test("a key that someone swaps in, with no valid signature, is not trusted (#775)", async () => {
    const file = await keyFile();
    const next = await nextVaultKey(file, await unlockVaultKey(file, password), "a brand new password", cost);
    const stranger = await createVaultKey("someone else's password", cost);
    // The old chain on a stranger's key: its signature covers another key.
    expect(chainTrusts({ ...stranger, chain: next.chain ?? [] }, keyFingerprint(file))).toBe(false);
    expect(chainTrusts(stranger, keyFingerprint(file))).toBe(false);
    const link = next.chain?.[0];
    if (link === undefined) throw new Error("No link.");
    // A link that names other public keys no longer matches the trusted fingerprint.
    expect(chainTrusts({ ...next, chain: [{ ...link, publicKey: stranger.publicKey }] }, keyFingerprint(file))).toBe(
      false,
    );
    expect(chainTrusts({ ...next, chain: [{ ...link, signature: "AAAA" }] }, keyFingerprint(file))).toBe(false);
  });

  test("the chain keeps the last 20 keys, so a key file stays small (#775)", async () => {
    let file = await keyFile();
    let current = password;
    for (let round = 0; round < 22; round += 1) {
      const next = `password number ${String(round)}`;
      file = await nextVaultKey(file, await unlockVaultKey(file, current), next, { logN: 1 });
      current = next;
    }
    expect(file.chain).toHaveLength(20);
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

describe("the same password from any device (review of #707)", () => {
  test("outer spaces and the Unicode form of a letter do not change the password", async () => {
    const file = await createVaultKey("  contraseña segura larga  ", { logN: 10 });
    expect(await unlockVaultKey(file, "contraseña segura larga")).toBeDefined();
    expect(await unlockVaultKey(file, "contraseña segura larga".normalize("NFD"))).toBeDefined();
  });
});

describe("the path inside an encrypted file (second review of #707)", () => {
  test("travels inside the encrypted text, so a copy under another name tells where it came from", async () => {
    const file = await keyFile();
    const encrypted = encryptFile(text("secret"), file, "Life/Health/blood.md");
    expect(plainText(encrypted)).not.toContain("Health");
    const opened = decryptFile(encrypted, await unlockVaultKey(file, password));
    expect(opened.path).toBe("Life/Health/blood.md");
    expect(plainText(opened.plain)).toBe("secret");
  });
});
