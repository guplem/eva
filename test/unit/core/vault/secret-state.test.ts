import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultKey, keyFingerprint, unlockVaultKey } from "../../../../src/core/vault/vault-crypto.ts";
import {
  readMachineSecrets,
  readSignedState,
  readVaultKey,
  signedStatePath,
  vaultKeyPath,
  writeMachineSecrets,
  writeSignedState,
  writeVaultKey,
} from "../../../../src/core/vault/secret-state.ts";

let root: string;
let vault: string;
const password = "correct horse battery";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-secret-state-"));
  vault = join(root, "vault");
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the vault's key file (#707)", () => {
  test("is written to the vault and read back; a missing or broken file reads as no key", async () => {
    expect(readVaultKey(vault)).toBeNull();
    const key = await createVaultKey(password, { logN: 10 });
    writeVaultKey(vault, key);
    expect(readVaultKey(vault)).toEqual(key);
    writeFileSync(join(vault, vaultKeyPath), "{ broken");
    expect(readVaultKey(vault)).toBeNull();
    writeFileSync(join(vault, vaultKeyPath), JSON.stringify({ version: 1, publicKey: 3 }));
    expect(readVaultKey(vault)).toBeNull();
  });
});

describe("the signed record of the secret patterns (#707)", () => {
  test("a record signed by the vault's key reads back; another key, an old sequence or a change do not", async () => {
    const key = await createVaultKey(password, { logN: 10 });
    const unlocked = await unlockVaultKey(key, password);
    const state = { sequence: 3, fingerprint: keyFingerprint(key), known: ["*.key", "*.pem"], active: ["*.pem"] };
    writeSignedState(vault, state, unlocked);
    expect(readSignedState(vault, key, 0)).toEqual(state);
    expect(readSignedState(vault, key, 3)).toEqual(state);
    // An older record that an agent copies back from git history does nothing.
    expect(readSignedState(vault, key, 4)).toBeNull();
    expect(readSignedState(vault, await createVaultKey(password, { logN: 10 }), 0)).toBeNull();
    const file = join(vault, signedStatePath);
    writeFileSync(file, readFileSync(file, "utf8").replace('\\"*.key\\",', ""));
    expect(readSignedState(vault, key, 0)).toBeNull();
  });

  test("a record of another key's fingerprint does nothing, even when that key signed it", async () => {
    const key = await createVaultKey(password, { logN: 10 });
    const unlocked = await unlockVaultKey(key, password);
    writeSignedState(vault, { sequence: 1, fingerprint: "0123456789abcdef", known: [], active: [] }, unlocked);
    expect(readSignedState(vault, key, 0)).toBeNull();
  });

  test("a missing or broken record reads as none", async () => {
    const key = await createVaultKey(password, { logN: 10 });
    expect(readSignedState(vault, key, 0)).toBeNull();
    writeFileSync(join(vault, signedStatePath), "<<<<<<< ours");
    expect(readSignedState(vault, key, 0)).toBeNull();
  });
});

describe("each machine's own memory (#707)", () => {
  test("keeps the key's fingerprint, the highest sequence and every applied pattern", () => {
    const path = join(root, "state", "vault-secrets.json");
    expect(readMachineSecrets(path)).toEqual({ fingerprint: null, sequence: 0, applied: [] });
    writeMachineSecrets(path, { fingerprint: "0123456789abcdef", sequence: 2, applied: ["*.pem"] });
    expect(readMachineSecrets(path)).toEqual({ fingerprint: "0123456789abcdef", sequence: 2, applied: ["*.pem"] });
    writeFileSync(path, "nonsense");
    expect(readMachineSecrets(path)).toEqual({ fingerprint: null, sequence: 0, applied: [] });
  });
});
