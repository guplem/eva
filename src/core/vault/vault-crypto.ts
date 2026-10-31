/**
 * The encryption of the vault's secret files (#707), with `node:crypto` only, so it works the same on
 * Windows and Linux. The vault has one X25519 key pair. Its public key is plain, so any machine can
 * encrypt with no password. Its private key is wrapped with a key that `scrypt` derives from the
 * person's password, so only reading needs the password. A file is encrypted to the public key with
 * a key pair of its own: HKDF derives an AES-256-GCM key from the shared secret. An Ed25519 key pair,
 * wrapped with the same password, signs what only the person may confirm.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { EvaError } from "../../shared/errors.ts";

/** The first line of each encrypted file, so an agent that opens one knows what to tell the person. */
export const encryptedFileLine = "Encrypted by Eva. Open this file in Eva's Files page to read it.";
const formatLine = "eva-encrypted-v1";
const header = `${encryptedFileLine}\n${formatLine}\n`;

/** The thief of the remote has the wrapped key and can try passwords offline, so a password must be long. */
export const minimumPasswordLength = 12;

/** Eva's own `scrypt` cost: 2^17 rounds, about 128 MB of memory. */
const defaultCost = { logN: 17 };

export interface VaultKeyFile {
  readonly version: 1;
  /** The X25519 public key, raw, in base64. Files are encrypted to it. */
  readonly publicKey: string;
  /**
   * The Ed25519 public key, raw, in base64. It checks a record that only an unlocked device can sign,
   * such as a confirmed removal of a secret pattern, so an agent cannot fake one.
   */
  readonly signingKey: string;
  readonly kdf: {
    readonly name: "scrypt";
    readonly logN: number;
    readonly r: number;
    readonly p: number;
    readonly salt: string;
  };
  /** Both private keys, wrapped with AES-256-GCM: nonce, then cipher text, then tag, in base64. */
  readonly wrappedPrivateKey: string;
}

/** The unlocked private keys. They live in memory only. */
export interface UnlockedVaultKey {
  readonly agreement: KeyObject;
  readonly signing: KeyObject;
}

/** New key pairs, wrapped with the password. Throws `vault_password_invalid` for a short password. */
export function createVaultKey(password: string, cost: { readonly logN: number } = defaultCost): VaultKeyFile {
  checkPassword(password);
  return wrap(
    { agreement: generateKeyPairSync("x25519").privateKey, signing: generateKeyPairSync("ed25519").privateKey },
    password,
    cost,
  );
}

/** The same private keys, wrapped with a new password. No file of the vault changes. */
export function rewrapVaultKey(
  file: VaultKeyFile,
  unlocked: UnlockedVaultKey,
  password: string,
  cost: { readonly logN: number } = defaultCost,
): VaultKeyFile {
  checkPassword(password);
  const rewrapped = wrap(unlocked, password, cost);
  if (keyFingerprint(rewrapped) !== keyFingerprint(file))
    throw new EvaError("vault_password_wrong", "This key does not belong to the vault.");
  return rewrapped;
}

/** Throws `vault_password_wrong` when the password does not unlock the key. */
export function unlockVaultKey(file: VaultKeyFile, password: string): UnlockedVaultKey {
  const wrapped = Buffer.from(file.wrappedPrivateKey, "base64");
  const key = passwordKey(password, file.kdf);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, wrapped.subarray(0, 12));
    decipher.setAuthTag(wrapped.subarray(wrapped.length - 16));
    const plain = Buffer.concat([decipher.update(wrapped.subarray(12, wrapped.length - 16)), decipher.final()]);
    const parts = JSON.parse(plain.toString("utf8")) as { agreement: string; signing: string };
    const privateKey = (der: string): KeyObject =>
      createPrivateKey({ key: Buffer.from(der, "base64"), format: "der", type: "pkcs8" });
    return { agreement: privateKey(parts.agreement), signing: privateKey(parts.signing) };
  } catch {
    throw new EvaError("vault_password_wrong", "This password does not unlock the vault.");
  }
}

/**
 * A short, stable name of the key, which each machine keeps to see when the vault's key changes. It
 * covers both public keys: an agent that swaps one must not keep the name.
 */
export function keyFingerprint(file: Pick<VaultKeyFile, "publicKey" | "signingKey">): string {
  return createHash("sha256").update(`${file.publicKey}\n${file.signingKey}`).digest("hex").slice(0, 16);
}

/** The Ed25519 signature of a record's text, in base64. */
export function signRecord(text: string, unlocked: UnlockedVaultKey): string {
  return sign(null, Buffer.from(text, "utf8"), unlocked.signing).toString("base64");
}

/** True when the signature of the text is the vault's own. Any machine checks it with no password. */
export function verifyRecord(text: string, signature: string, file: Pick<VaultKeyFile, "signingKey">): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ed25519Prefix, Buffer.from(file.signingKey, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(text, "utf8"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** True for the bytes of a file that Eva encrypted. A plain file never starts with both lines. */
export function isEncryptedFile(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, header.length)).toString("utf8") === header;
}

/** The encrypted file: Eva's two lines, then the base64 of the file key, nonce, cipher text and tag. */
export function encryptFile(plain: Uint8Array, file: Pick<VaultKeyFile, "publicKey">): Uint8Array {
  const recipient = publicKeyOf(file.publicKey);
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralRaw = rawPublicKey(ephemeral.publicKey);
  const key = fileKey(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient }), ephemeralRaw, file);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([ephemeralRaw, nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return new TextEncoder().encode(`${header}${wrapLines(body.toString("base64"))}\n`);
}

/** Throws `vault_file_unreadable` for a file that is not Eva's, or that someone changed. */
export function decryptFile(bytes: Uint8Array, unlocked: UnlockedVaultKey): Uint8Array {
  const unreadable = (): EvaError =>
    new EvaError("vault_file_unreadable", "This encrypted file does not open. Someone may have changed it.");
  if (!isEncryptedFile(bytes)) throw unreadable();
  const body = Buffer.from(Buffer.from(bytes.subarray(header.length)).toString("utf8").replace(/\s+/g, ""), "base64");
  if (body.length < 32 + 12 + 16) throw unreadable();
  try {
    const ephemeralRaw = body.subarray(0, 32);
    const publicKey = rawPublicKey(createPublicKey(unlocked.agreement)).toString("base64");
    const shared = diffieHellman({ privateKey: unlocked.agreement, publicKey: publicKeyOf(ephemeralRaw) });
    const key = fileKey(shared, ephemeralRaw, { publicKey });
    const decipher = createDecipheriv("aes-256-gcm", key, body.subarray(32, 44));
    decipher.setAuthTag(body.subarray(body.length - 16));
    return new Uint8Array(Buffer.concat([decipher.update(body.subarray(44, body.length - 16)), decipher.final()]));
  } catch {
    throw unreadable();
  }
}

function checkPassword(password: string): void {
  // Characters as a person sees them, so a password of emoji or accents counts right.
  const length = [...new Intl.Segmenter().segment(password)].length;
  if (length < minimumPasswordLength)
    throw new EvaError(
      "vault_password_invalid",
      `The vault password needs at least ${String(minimumPasswordLength)} characters.`,
    );
}

function wrap(keys: UnlockedVaultKey, password: string, cost: { readonly logN: number }): VaultKeyFile {
  const kdf = { name: "scrypt" as const, logN: cost.logN, r: 8, p: 1, salt: randomBytes(16).toString("base64") };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", passwordKey(password, kdf), nonce);
  const der = (key: KeyObject): string => key.export({ format: "der", type: "pkcs8" }).toString("base64");
  const plain = Buffer.from(JSON.stringify({ agreement: der(keys.agreement), signing: der(keys.signing) }), "utf8");
  const wrapped = Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    version: 1,
    publicKey: rawPublicKey(createPublicKey(keys.agreement)).toString("base64"),
    signingKey: rawPublicKey(createPublicKey(keys.signing)).toString("base64"),
    kdf,
    wrappedPrivateKey: wrapped.toString("base64"),
  };
}

function passwordKey(password: string, kdf: VaultKeyFile["kdf"]): Buffer {
  const rounds = 2 ** kdf.logN;
  // scrypt needs 128 * N * r bytes; the default limit of 32 MB is too small for Eva's cost.
  const maxmem = 256 * rounds * kdf.r;
  return scryptSync(password.normalize("NFC"), Buffer.from(kdf.salt, "base64"), 32, {
    N: rounds,
    r: kdf.r,
    p: kdf.p,
    maxmem,
  });
}

function fileKey(shared: Buffer, ephemeralRaw: Buffer, file: Pick<VaultKeyFile, "publicKey">): Buffer {
  const salt = Buffer.concat([ephemeralRaw, Buffer.from(file.publicKey, "base64")]);
  return Buffer.from(hkdfSync("sha256", shared, salt, "eva vault file v1", 32));
}

/** The last 32 bytes of the SPKI form are the raw X25519 key. */
function rawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

const spkiPrefix = Buffer.from("302a300506032b656e032100", "hex");
const ed25519Prefix = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyOf(raw: string | Buffer): KeyObject {
  const bytes = typeof raw === "string" ? Buffer.from(raw, "base64") : raw;
  return createPublicKey({ key: Buffer.concat([spkiPrefix, bytes]), format: "der", type: "spki" });
}

/** Lines of 76 characters, so a diff tool or an editor never shows one huge line. */
function wrapLines(text: string): string {
  return text.match(/.{1,76}/g)?.join("\n") ?? "";
}
