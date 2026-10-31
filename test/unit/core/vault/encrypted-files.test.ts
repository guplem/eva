import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  decryptFiles,
  encryptAgain,
  filesFreedBy,
  readEncryptedFile,
  saveEncryptedFile,
} from "../../../../src/core/vault/encrypted-files.ts";
import { SecretMatcher } from "../../../../src/core/vault/secret-files.ts";
import {
  createVaultKey,
  encryptedState,
  encryptFile,
  unlockVaultKey,
  type UnlockedVaultKey,
  type VaultKeyFile,
} from "../../../../src/core/vault/vault-crypto.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let root: string;
let vault: string;
let key: VaultKeyFile;
let unlocked: UnlockedVaultKey;

function write(path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), bytes);
}

function writeEncrypted(path: string, plain: string | Uint8Array, file = key): void {
  write(path, encryptFile(typeof plain === "string" ? new TextEncoder().encode(plain) : plain, file));
}

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(join(vault, path)));

async function failure(work: () => unknown): Promise<unknown> {
  try {
    await work();
    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "eva-encrypted-files-"));
  vault = join(root, "vault");
  mkdirSync(vault, { recursive: true });
  key = await createVaultKey("correct horse battery", { logN: 10 });
  unlocked = await unlockVaultKey(key, "correct horse battery");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("reading and saving an encrypted file (#707)", () => {
  test("a text file opens as text, with a version for its save", () => {
    writeEncrypted("Projects/app/.env.local", "API_KEY=sk-example\n");
    const opened = readEncryptedFile(vault, "Projects/app/.env.local", unlocked);
    expect(opened).toMatchObject({ kind: "text", text: "API_KEY=sk-example\n" });
  });

  test("a binary file opens as bytes, for a download", () => {
    writeEncrypted("certs/me.p12", new Uint8Array([0, 1, 2, 255]));
    expect(readEncryptedFile(vault, "certs/me.p12", unlocked)).toEqual({
      kind: "binary",
      bytes: new Uint8Array([0, 1, 2, 255]),
    });
  });

  test("a save writes the encrypted text, never the plain text, and a changed file refuses it", () => {
    writeEncrypted("Projects/app/.env.local", "API_KEY=old\n");
    const opened = readEncryptedFile(vault, "Projects/app/.env.local", unlocked);
    if (opened.kind !== "text") throw new Error("expected text");
    saveEncryptedFile(vault, "Projects/app/.env.local", "API_KEY=new\n", opened.version, key);
    const saved = read("Projects/app/.env.local");
    expect(encryptedState(saved)).toBe("encrypted");
    expect(new TextDecoder().decode(saved)).not.toContain("API_KEY");
    expect(readEncryptedFile(vault, "Projects/app/.env.local", unlocked)).toMatchObject({ text: "API_KEY=new\n" });
    const caught = (() => {
      try {
        saveEncryptedFile(vault, "Projects/app/.env.local", "x", opened.version, key);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(isEvaError(caught, "file_changed")).toBe(true);
  });

  test("a path out of the vault, a link, a plain file or a missing file is refused", async () => {
    write("Notes/plain.md", "plain");
    writeEncrypted("Notes/target.pem", "secret");
    symlinkSync(join(vault, "Notes", "target.pem"), join(vault, "Notes", "link.pem"));
    for (const path of ["../outside.pem", "Notes/link.pem", "Notes/plain.md", "Notes/missing.pem", ".git/config"])
      expect(isEvaError(await failure(() => readEncryptedFile(vault, path, unlocked)))).toBe(true);
  });
});

describe("a confirmed removal and a new key (#707)", () => {
  test("a removal decrypts only the files that no pattern covers any more", () => {
    writeEncrypted("deploy/id.key", "KEY\n");
    writeEncrypted("Toolbox/server.pem", "PEM\n");
    // A conflict copy keeps Eva's header, but no pattern names it: a removal must not touch it.
    writeEncrypted("Notes/old (conflict copy).md", "OLD\n");
    const decrypted = filesFreedBy(vault, new SecretMatcher(["*.key"]), new SecretMatcher(["*.pem"]));
    decryptFiles(vault, decrypted, unlocked);
    expect(decrypted).toEqual(["deploy/id.key"]);
    expect(new TextDecoder().decode(read("deploy/id.key"))).toBe("KEY\n");
    expect(encryptedState(read("Toolbox/server.pem"))).toBe("encrypted");
    expect(encryptedState(read("Notes/old (conflict copy).md"))).toBe("encrypted");
  });

  test("a removal gives a binary file back byte for byte", () => {
    const bytes = new Uint8Array([0, 1, 2, 200, 255]);
    writeEncrypted("certs/me.p12", bytes);
    decryptFiles(vault, filesFreedBy(vault, new SecretMatcher(["*.p12"]), new SecretMatcher([])), unlocked);
    expect(read("certs/me.p12")).toEqual(bytes);
  });

  test("a new key encrypts each encrypted file again, and the old key opens none", async () => {
    writeEncrypted("deploy/id.key", "KEY\n");
    const next = await createVaultKey("another long password", { logN: 10 });
    expect(encryptAgain(vault, unlocked, next)).toEqual({ moved: ["deploy/id.key"], unreadable: [] });
    const reopened = readEncryptedFile(vault, "deploy/id.key", await unlockVaultKey(next, "another long password"));
    expect(reopened).toMatchObject({ text: "KEY\n" });
    expect(isEvaError(await failure(() => readEncryptedFile(vault, "deploy/id.key", unlocked)))).toBe(true);
  });
});
