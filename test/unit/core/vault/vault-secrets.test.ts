import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createVaultKey,
  decryptFile,
  encryptedState,
  encryptFile,
  keyFingerprint,
  unlockVaultKey,
  type VaultKeyFile,
} from "../../../../src/core/vault/vault-crypto.ts";
import { readMachineSecrets, writeVaultKey } from "../../../../src/core/vault/secret-state.ts";
import { VaultSecrets } from "../../../../src/core/vault/vault-secrets.ts";

let root: string;
let vault: string;
let machine: string;
const password = "correct horse battery";

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(join(vault, path)));

function secrets(): VaultSecrets {
  return new VaultSecrets({ vaultPath: vault, machineStatePath: machine });
}

async function withKey(): Promise<VaultKeyFile> {
  const key = await createVaultKey(password, { logN: 10 });
  writeVaultKey(vault, key);
  return key;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-vault-secrets-"));
  vault = join(root, "vault");
  machine = join(root, "state", "vault-secrets.json");
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("preparing the vault's files for a commit (#707)", () => {
  test("a plain secret file is encrypted in place, and opens again with the password", async () => {
    const key = await withKey();
    write("Projects/coach/.env.local", "API_KEY=sk-example\n");
    expect(secrets().prepare("Projects/coach/.env.local")).toBeNull();
    const encrypted = read("Projects/coach/.env.local");
    expect(encryptedState(encrypted)).toBe("encrypted");
    const plain = decryptFile(encrypted, await unlockVaultKey(key, password));
    expect(new TextDecoder().decode(plain)).toBe("API_KEY=sk-example\n");
  });

  test("an encrypted file is never encrypted again, so two machines never fight over it", async () => {
    const key = await withKey();
    write("Toolbox/server.pem", new TextDecoder().decode(encryptFile(new TextEncoder().encode("PEM"), key)));
    const before = read("Toolbox/server.pem");
    expect(secrets().prepare("Toolbox/server.pem")).toBeNull();
    expect(read("Toolbox/server.pem")).toEqual(before);
  });

  test("a file with Eva's header but a changed body stays out of the commit", async () => {
    const key = await withKey();
    const encrypted = new TextDecoder().decode(encryptFile(new TextEncoder().encode("PEM"), key));
    write("Toolbox/server.pem", `${encrypted}TOKEN=plain\n`);
    expect(secrets().prepare("Toolbox/server.pem")).toBe("not_decryptable");
  });

  test("with no key yet, a secret file stays out, plain, and other files are untouched", () => {
    write("Projects/coach/.env.local", "API_KEY=sk-example\n");
    write("Notes/a.md", "A note.\n");
    expect(secrets().prepare("Projects/coach/.env.local")).toBe("no_vault_key");
    expect(new TextDecoder().decode(read("Projects/coach/.env.local"))).toBe("API_KEY=sk-example\n");
    expect(secrets().prepare("Notes/a.md")).toBeNull();
  });

  test("the first key that a machine sees is pinned; a changed key encrypts nothing", async () => {
    const first = await withKey();
    write("a.pem", "PEM\n");
    expect(secrets().prepare("a.pem")).toBeNull();
    expect(readMachineSecrets(machine).fingerprint).toBe(keyFingerprint(first));
    await withKey();
    write("b.pem", "PEM\n");
    expect(secrets().prepare("b.pem")).toBe("vault_key_changed");
    expect(new TextDecoder().decode(read("b.pem"))).toBe("PEM\n");
  });

  test("a plain .env with a token stays out, and a plain .env with safe values goes in", async () => {
    await withKey();
    write("Projects/app/.env", "PORT=3000\n");
    expect(secrets().prepare("Projects/app/.env")).toBeNull();
    write("Projects/app/.env", "PORT=3000\nGITHUB_TOKEN=ghp_" + "a".repeat(36) + "\n");
    expect(secrets().prepare("Projects/app/.env")).toBe("env_has_secret");
  });

  test("a link with a secret name is never followed, so its target is never written", async () => {
    await withKey();
    write("Notes/target.md", "Not a secret.\n");
    symlinkSync(join(vault, "Notes", "target.md"), join(vault, "link.pem"));
    expect(secrets().prepare("link.pem")).toBe("secret");
    expect(new TextDecoder().decode(read("Notes/target.md"))).toBe("Not a secret.\n");
  });

  test("a person's pattern encrypts its files, and a pattern applied once stays after its line goes", async () => {
    await withKey();
    write(".eva/secret-files", "Life/Health/**\n");
    write("Life/Health/blood.md", "Results.\n");
    expect(secrets().prepare("Life/Health/blood.md")).toBeNull();
    expect(encryptedState(read("Life/Health/blood.md"))).toBe("encrypted");
    write(".eva/secret-files", "");
    write("Life/Health/sleep.md", "Notes.\n");
    expect(secrets().prepare("Life/Health/sleep.md")).toBeNull();
    expect(encryptedState(read("Life/Health/sleep.md"))).toBe("encrypted");
    expect(secrets().policy().waiting).toEqual(["Life/Health/**"]);
  });
});

describe("the vault's .gitattributes (#707)", () => {
  const attributes = (): string => new TextDecoder().decode(read(".gitattributes"));

  test("each active pattern gets a line that stops git from merging or changing it, in Eva's block", async () => {
    await withKey();
    write(".gitattributes", "*.png binary\n");
    secrets().prepare("Notes/a.md");
    const text = attributes();
    expect(text).toStartWith("*.png binary\n");
    expect(text).toContain("# Eva: encrypted files. Eva writes this block.\n");
    expect(text).toContain("*.pem -diff -merge -text\n");
    expect(text).toContain(".env.local -diff -merge -text\n");
    // A second round changes nothing.
    secrets().prepare("Notes/a.md");
    expect(attributes()).toBe(text);
  });

  test("a line that a newer Eva wrote stays, so two versions never fight over the block", async () => {
    await withKey();
    secrets().prepare("Notes/a.md");
    write(".gitattributes", attributes().replace("*.pem -diff", "*.newer -diff -merge -text\n*.pem -diff"));
    secrets().prepare("Notes/a.md");
    expect(attributes()).toContain("*.newer -diff -merge -text\n");
  });
});
