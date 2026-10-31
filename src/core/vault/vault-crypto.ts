/**
 * The encryption of the vault's secret files (#707), with `node:crypto` only, so it works the same on
 * Windows and Linux. The vault has one X25519 key pair. Its public key is plain, so any machine can
 * encrypt with no password. Its private key is wrapped with a key that `scrypt` derives from the
 * person's password, so only reading needs the password. A file is encrypted to the public key with
 * a key pair of its own: HKDF derives an AES-256-GCM key from the shared secret. An Ed25519 key pair,
 * wrapped with the same password, signs what only the person may confirm.
 *
 * An agent can change any file of the vault, so every read here checks what it reads, and every
 * fault is an `EvaError`: a bad file never crashes Eva.
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
  scrypt,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { EvaError } from "../../shared/errors.ts";
import { minimumPasswordLength } from "../../shared/vault-unlock.ts";

/** The first line of each encrypted file, so an agent that opens one knows what to tell the person. */
export const encryptedFileLine = "Encrypted by Eva. Open this file in Eva's Files page to read it.";
const formatName = "eva-encrypted";
const formatVersion = 1;

/** Eva's own `scrypt` cost: 2^17 rounds, about 128 MB of memory. */
const defaultCost = { logN: 17 };
/** A key file that asks for more could hang Eva or run her out of memory. */
const highestLogN = 18;
/** A salt longer than this protects nothing more. */
const longestSalt = 64;

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
  /**
   * Both private keys, wrapped with AES-256-GCM: nonce, then cipher text, then tag, in base64. The
   * public keys and the kdf fields are its extra authenticated data, so a change to them fails the unlock.
   */
  readonly wrappedPrivateKey: string;
}

/** The unlocked private keys. They live in memory only. */
export interface UnlockedVaultKey {
  readonly agreement: KeyObject;
  readonly signing: KeyObject;
}

/** What a file's first lines say. A file in a newer format is never encrypted again, nor opened. */
export type EncryptedState = "plain" | "encrypted" | "newer";

/** New key pairs, wrapped with the password. Throws `vault_password_invalid` for a short password. */
export function createVaultKey(password: string, cost: { readonly logN: number } = defaultCost): Promise<VaultKeyFile> {
  checkPassword(password);
  return wrap(
    { agreement: generateKeyPairSync("x25519").privateKey, signing: generateKeyPairSync("ed25519").privateKey },
    password,
    cost,
  );
}

/** The same private keys, wrapped with a new password. No file of the vault changes. */
export async function rewrapVaultKey(
  file: VaultKeyFile,
  unlocked: UnlockedVaultKey,
  password: string,
  cost: { readonly logN: number } = defaultCost,
): Promise<VaultKeyFile> {
  checkPassword(password);
  const rewrapped = await wrap(unlocked, password, cost);
  if (keyFingerprint(rewrapped) !== keyFingerprint(file))
    throw new EvaError("vault_password_wrong", "This key does not belong to the vault.");
  return rewrapped;
}

/**
 * Throws `vault_password_wrong` when the password does not unlock the key, and `vault_key_invalid`
 * for a key file that is broken or that someone changed.
 */
export async function unlockVaultKey(file: VaultKeyFile, password: string): Promise<UnlockedVaultKey> {
  checkKeyFile(file);
  const wrapped = Buffer.from(file.wrappedPrivateKey, "base64");
  if (wrapped.length < 12 + 16 + 1) throw invalidKey();
  const key = await passwordKey(password, file.kdf);
  let unlocked: UnlockedVaultKey;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, wrapped.subarray(0, 12));
    decipher.setAAD(keyFileAad(file));
    decipher.setAuthTag(wrapped.subarray(wrapped.length - 16));
    const plain = Buffer.concat([decipher.update(wrapped.subarray(12, wrapped.length - 16)), decipher.final()]);
    const parts = JSON.parse(plain.toString("utf8")) as { agreement: string; signing: string };
    const privateKey = (der: string): KeyObject =>
      createPrivateKey({ key: Buffer.from(der, "base64"), format: "der", type: "pkcs8" });
    unlocked = { agreement: privateKey(parts.agreement), signing: privateKey(parts.signing) };
  } catch {
    throw new EvaError("vault_password_wrong", "This password does not unlock the vault.");
  }
  // The extra authenticated data binds the public keys, but a check here costs nothing.
  if (keyFingerprint(publicKeysOf(unlocked)) !== keyFingerprint(file)) throw invalidKey();
  return unlocked;
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
    return verify(
      null,
      Buffer.from(text, "utf8"),
      publicKeyOf(file.signingKey, ed25519Prefix),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * What the first lines of a file say. Only the first two lines count, and a BOM or Windows line ends
 * do not change the answer: Eva must never encrypt an encrypted file again.
 */
export function encryptedState(bytes: Uint8Array): EncryptedState {
  const head = headerOf(bytes);
  if (head === null) return "plain";
  return head.version === formatVersion ? "encrypted" : "newer";
}

/** True for a file that Eva encrypted, in this format or a newer one. */
export function isEncryptedFile(bytes: Uint8Array): boolean {
  return encryptedState(bytes) !== "plain";
}

/** The fingerprint of the key that a file was encrypted to, or null for a plain file. */
export function encryptedFingerprint(bytes: Uint8Array): string | null {
  return headerOf(bytes)?.fingerprint ?? null;
}

/**
 * True when the body after the header has the exact shape that Eva writes. It needs no key, so a
 * machine with no password can still find text that someone put after Eva's header.
 */
export function hasEncryptedShape(bytes: Uint8Array): boolean {
  const head = headerOf(bytes);
  if (head?.version !== formatVersion) return false;
  const lines = head.body.replace(/\r?\n$/, "").split(/\r?\n/);
  const last = lines.at(-1) ?? "";
  return (
    lines.every((line) => /^[A-Za-z0-9+/=]+$/.test(line)) &&
    lines.slice(0, -1).every((line) => line.length === 76) &&
    last.length > 0 &&
    last.length <= 76 &&
    lines.join("").length >= 80
  );
}

/** The encrypted file: Eva's two lines, then the base64 of the file key, nonce, cipher text and tag. */
/** What an encrypted file holds: its text, and the path that it had when Eva encrypted it. */
export interface DecryptedFile {
  /** A forward-slash path from the vault root. A copy under another name still names its first place. */
  readonly path: string;
  readonly plain: Uint8Array;
}

/**
 * Encrypts a file to the vault's public key, with no password. The path goes inside the encrypted
 * text, so a copy under another name, such as one that a removal would free, shows where it came from.
 */
export function encryptFile(
  plain: Uint8Array,
  file: Pick<VaultKeyFile, "publicKey" | "signingKey">,
  path: string,
): Uint8Array {
  const pathBytes = Buffer.from(path, "utf8");
  if (pathBytes.length > 0xffff) throw new EvaError("vault_file_unreadable", "This path is too long to encrypt.");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(pathBytes.length);
  const inner = Buffer.concat([length, pathBytes, plain]);
  const header = headerText(keyFingerprint(file));
  const recipient = publicKeyOf(file.publicKey, x25519Prefix);
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralRaw = rawPublicKey(ephemeral.publicKey);
  const key = fileKey(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient }), ephemeralRaw, file);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  // The header is authenticated too, so a file cannot claim another key.
  cipher.setAAD(Buffer.from(header, "utf8"));
  const body = Buffer.concat([ephemeralRaw, nonce, cipher.update(inner), cipher.final(), cipher.getAuthTag()]);
  return new TextEncoder().encode(`${header}${wrapLines(body.toString("base64"))}\n`);
}

/** Throws `vault_file_unreadable` for a file that is not Eva's, or that someone changed. */
export function decryptFile(bytes: Uint8Array, unlocked: UnlockedVaultKey): DecryptedFile {
  const unreadable = (): EvaError =>
    new EvaError("vault_file_unreadable", "This encrypted file does not open. Someone may have changed it.");
  const head = headerOf(bytes);
  if (head?.version !== formatVersion || !hasEncryptedShape(bytes)) throw unreadable();
  const body = Buffer.from(head.body.replace(/\s+/g, ""), "base64");
  if (body.length < 32 + 12 + 16) throw unreadable();
  try {
    const ephemeralRaw = body.subarray(0, 32);
    const keys = publicKeysOf(unlocked);
    const shared = diffieHellman({
      privateKey: unlocked.agreement,
      publicKey: publicKeyOf(ephemeralRaw, x25519Prefix),
    });
    const decipher = createDecipheriv("aes-256-gcm", fileKey(shared, ephemeralRaw, keys), body.subarray(32, 44));
    decipher.setAAD(Buffer.from(headerText(head.fingerprint), "utf8"));
    decipher.setAuthTag(body.subarray(body.length - 16));
    const inner = Buffer.concat([decipher.update(body.subarray(44, body.length - 16)), decipher.final()]);
    const length = inner.readUInt16BE(0);
    if (inner.length < 2 + length) throw unreadable();
    return { path: inner.subarray(2, 2 + length).toString("utf8"), plain: new Uint8Array(inner.subarray(2 + length)) };
  } catch {
    throw unreadable();
  }
}

function headerText(fingerprint: string): string {
  return `${encryptedFileLine}\n${formatName}-v${String(formatVersion)} ${fingerprint}\n`;
}

/** The two header lines of an encrypted file, or null. It reads only the start of the bytes. */
function headerOf(bytes: Uint8Array): { version: number; fingerprint: string; body: string } | null {
  // A UTF-8 byte order mark, which some Windows editors add.
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = Buffer.from(bytes.subarray(start, start + 400)).toString("utf8");
  const match = /^([^\r\n]*)\r?\n([^\r\n]*)\r?\n/.exec(head);
  if (match?.[1] !== encryptedFileLine) return null;
  const format = /^eva-encrypted-v(\d+)(?: ([0-9a-f]{16}))?$/.exec(match[2] ?? "");
  if (format === null) return null;
  const bodyStart = start + Buffer.byteLength(match[0], "utf8");
  return {
    version: Number(format[1]),
    fingerprint: format[2] ?? "",
    get body(): string {
      return Buffer.from(bytes.subarray(bodyStart)).toString("utf8");
    },
  };
}

function checkPassword(password: string): void {
  // Characters as a person sees them, so a password of emoji or accents counts right.
  const length = [...new Intl.Segmenter().segment(password.trim())].length;
  if (length < minimumPasswordLength)
    throw new EvaError(
      "vault_password_invalid",
      `The vault password needs at least ${String(minimumPasswordLength)} characters.`,
    );
}

function invalidKey(): EvaError {
  return new EvaError("vault_key_invalid", "The vault's key file is broken, or someone changed it.");
}

interface LooseKeyFile {
  readonly version?: unknown;
  readonly publicKey?: unknown;
  readonly signingKey?: unknown;
  readonly kdf?: {
    readonly name?: unknown;
    readonly logN?: unknown;
    readonly r?: unknown;
    readonly p?: unknown;
    readonly salt?: unknown;
  };
}

/** Bounds on each field, so a changed key file can neither crash Eva nor ask for a huge cost. */
function checkKeyFile(typed: VaultKeyFile): void {
  const raw = (value: unknown): number => (typeof value === "string" ? Buffer.from(value, "base64").length : 0);
  // The file comes from the vault, where anyone can write anything, whatever its type says.
  const file = typed as unknown as LooseKeyFile;
  const kdf = file.kdf ?? {};
  const logN = kdf.logN;
  const valid =
    file.version === 1 &&
    raw(file.publicKey) === 32 &&
    raw(file.signingKey) === 32 &&
    kdf.name === "scrypt" &&
    typeof logN === "number" &&
    Number.isInteger(logN) &&
    logN >= 1 &&
    logN <= highestLogN &&
    kdf.r === 8 &&
    kdf.p === 1 &&
    raw(kdf.salt) >= 16 &&
    raw(kdf.salt) <= longestSalt;
  if (!valid) throw invalidKey();
}

async function wrap(keys: UnlockedVaultKey, password: string, cost: { readonly logN: number }): Promise<VaultKeyFile> {
  const kdf = { name: "scrypt" as const, logN: cost.logN, r: 8, p: 1, salt: randomBytes(16).toString("base64") };
  const unwrapped = { version: 1 as const, ...publicKeysOf(keys), kdf };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await passwordKey(password, kdf), nonce);
  cipher.setAAD(keyFileAad(unwrapped));
  const der = (key: KeyObject): string => key.export({ format: "der", type: "pkcs8" }).toString("base64");
  const plain = Buffer.from(JSON.stringify({ agreement: der(keys.agreement), signing: der(keys.signing) }), "utf8");
  const wrapped = Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { ...unwrapped, wrappedPrivateKey: wrapped.toString("base64") };
}

function keyFileAad(file: Omit<VaultKeyFile, "wrappedPrivateKey">): Buffer {
  const { kdf } = file;
  return Buffer.from(
    JSON.stringify([file.version, file.publicKey, file.signingKey, kdf.name, kdf.logN, kdf.r, kdf.p, kdf.salt]),
    "utf8",
  );
}

function publicKeysOf(keys: UnlockedVaultKey): Pick<VaultKeyFile, "publicKey" | "signingKey"> {
  return {
    publicKey: rawPublicKey(createPublicKey(keys.agreement)).toString("base64"),
    signingKey: rawPublicKey(createPublicKey(keys.signing)).toString("base64"),
  };
}

/** The async form, since scrypt at Eva's cost takes about a second and would stop every other request. */
function passwordKey(password: string, kdf: VaultKeyFile["kdf"]): Promise<Buffer> {
  const rounds = 2 ** kdf.logN;
  // scrypt needs 128 * N * r bytes; the default limit of 32 MB is too small for Eva's cost.
  const maxmem = 256 * rounds * kdf.r;
  return new Promise((resolve, reject) => {
    scrypt(
      // Each device types the same password: a terminal trims it, and a phone writes a letter in another form.
      password.normalize("NFC").trim(),
      Buffer.from(kdf.salt, "base64"),
      32,
      { N: rounds, r: kdf.r, p: kdf.p, maxmem },
      (error, key) => {
        // Bun gives `undefined`, not `null`, for no error, so a truth test covers both.
        if (error) reject(invalidKey());
        else resolve(key);
      },
    );
  });
}

function fileKey(shared: Buffer, ephemeralRaw: Buffer, file: Pick<VaultKeyFile, "publicKey">): Buffer {
  const salt = Buffer.concat([ephemeralRaw, Buffer.from(file.publicKey, "base64")]);
  return Buffer.from(hkdfSync("sha256", shared, salt, "eva vault file v1", 32));
}

/** The last 32 bytes of the SPKI form are the raw key. */
function rawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

const x25519Prefix = Buffer.from("302a300506032b656e032100", "hex");
const ed25519Prefix = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyOf(raw: string | Buffer, prefix: Buffer): KeyObject {
  const bytes = typeof raw === "string" ? Buffer.from(raw, "base64") : raw;
  if (bytes.length !== 32) throw invalidKey();
  return createPublicKey({ key: Buffer.concat([prefix, bytes]), format: "der", type: "spki" });
}

/** Lines of 76 characters, so a diff tool or an editor never shows one huge line. */
function wrapLines(text: string): string {
  const lines: string[] = [];
  for (let start = 0; start < text.length; start += 76) lines.push(text.slice(start, start + 76));
  return lines.join("\n");
}
