import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readVaultKey } from "../../../../src/core/vault/secret-state.ts";
import { VaultEncryption } from "../../../../src/core/vault/vault-encryption.ts";
import { encryptedState, keyFingerprint } from "../../../../src/core/vault/vault-crypto.ts";
import { VaultKeys } from "../../../../src/core/vault/vault-keys.ts";
import { VaultSecrets } from "../../../../src/core/vault/vault-secrets.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let root: string;
let vault: string;
let saves: number;
let secrets: VaultSecrets;
const password = "correct horse battery";
const token = "phone-token";

function write(path: string, text: string): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

const read = (path: string): string => readFileSync(join(vault, path), "utf8");

function encryption(): VaultEncryption {
  return new VaultEncryption({
    vaultPath: () => vault,
    secrets: () => secrets,
    keys: new VaultKeys({ vaultPath: () => vault, now: () => new Date(), isDeviceValid: (each) => each === token }),
    // The vault sync of a test: each save runs one round of the secret files, as a commit does.
    vault: {
      exclusive: (work) => Promise.resolve().then(work),
      pull: () => Promise.resolve(),
      encryptSecrets: () => {
        const prepare = secrets.round();
        for (const path of ["deploy/id.key", "Toolbox/server.pem", "Life/Health/blood.md"]) prepare(path);
        return Promise.resolve();
      },
      save: () => {
        saves += 1;
        return Promise.resolve();
      },
    },
    cost: { logN: 10 },
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-vault-encryption-"));
  vault = join(root, "vault");
  mkdirSync(join(vault, ".eva"), { recursive: true });
  secrets = new VaultSecrets({ vaultPath: vault, machineStatePath: join(root, "state", "vault-secrets.json") });
  saves = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the vault password (#707)", () => {
  test("a new password makes the vault's key once, pins it, and saves the vault", async () => {
    const service = encryption();
    expect(service.status(null, null)).toMatchObject({ hasKey: false, unlocked: false });
    await service.setPassword(password);
    const key = readVaultKey(vault);
    expect(key).not.toBeNull();
    expect(secrets.inputs().machine.fingerprint).toBe(keyFingerprint(key ?? { publicKey: "", signingKey: "" }));
    expect(saves).toBe(1);
    expect(isEvaError(await failure(() => service.setPassword(password)), "vault_key_invalid")).toBe(true);
  });

  test("a device unlocks, reads and saves an encrypted file, and Lock forgets it", async () => {
    const service = encryption();
    await service.setPassword(password);
    write("deploy/id.key", "OLD\n");
    await service.setPatterns({ added: [], off: [] });
    expect(encryptedState(new TextEncoder().encode(read("deploy/id.key")))).toBe("encrypted");
    const secret = await service.unlock(token, password);
    expect(service.status(token, secret).unlocked).toBe(true);
    const opened = service.readFile(token, secret, "deploy/id.key");
    if (opened.kind !== "text") throw new Error("expected text");
    expect(opened.text).toBe("OLD\n");
    await service.saveFile(token, secret, "deploy/id.key", "NEW\n", opened.version);
    expect(service.readFile(token, secret, "deploy/id.key")).toMatchObject({ text: "NEW\n" });
    service.lock(token);
    expect(isEvaError(await failure(() => service.readFile(token, secret, "deploy/id.key")), "vault_locked")).toBe(
      true,
    );
  });

  test("a new password keeps every file readable; a new key moves each file to it", async () => {
    const service = encryption();
    await service.setPassword(password);
    write("deploy/id.key", "KEY\n");
    await service.setPatterns({ added: [], off: [] });
    let secret = await service.unlock(token, password);
    await service.changePassword(token, secret, "a second long password");
    secret = await service.unlock(token, "a second long password");
    expect(service.readFile(token, secret, "deploy/id.key")).toMatchObject({ text: "KEY\n" });
    const before = readVaultKey(vault);
    await service.newKey(token, secret, "a third long password");
    expect(keyFingerprint(readVaultKey(vault) ?? { publicKey: "", signingKey: "" })).not.toBe(
      keyFingerprint(before ?? { publicKey: "", signingKey: "" }),
    );
    // Every device locks: the old key opens nothing any more.
    expect(service.status(token, secret).unlocked).toBe(false);
    secret = await service.unlock(token, "a third long password");
    expect(service.readFile(token, secret, "deploy/id.key")).toMatchObject({ text: "KEY\n" });
  });
});

describe("the person's patterns and a confirmed removal (#707)", () => {
  test("an added pattern encrypts its files at once", async () => {
    const service = encryption();
    await service.setPassword(password);
    write("Life/Health/blood.md", "Results.\n");
    await service.setPatterns({ added: ["Life/Health/**"], off: [] });
    expect(read(".eva/secret-files")).toContain("Life/Health/**");
    expect(encryptedState(new TextEncoder().encode(read("Life/Health/blood.md")))).toBe("encrypted");
  });

  test("a default turned off waits; only a confirmation from an unlocked device decrypts its files", async () => {
    const service = encryption();
    await service.setPassword(password);
    write("deploy/id.key", "KEY\n");
    await service.setPatterns({ added: [], off: [] });
    await service.setPatterns({ added: [], off: ["*.key"] });
    expect(service.status(null, null).waiting).toEqual(["*.key"]);
    expect(encryptedState(new TextEncoder().encode(read("deploy/id.key")))).toBe("encrypted");
    expect(isEvaError(await failure(() => service.confirmRemovals(token, "no secret")), "vault_locked")).toBe(true);
    const secret = await service.unlock(token, password);
    expect(await service.confirmRemovals(token, secret)).toEqual(["deploy/id.key"]);
    expect(read("deploy/id.key")).toBe("KEY\n");
    expect(service.status(null, null).waiting).toEqual([]);
    const defaults = service.status(null, null).defaults;
    expect(defaults.find((entry) => entry.pattern === "*.key")).toMatchObject({ on: false });
  });

  test("a key that changed on another machine waits until the person types its password here", async () => {
    const service = encryption();
    await service.setPassword(password);
    // Another machine made a new key; this machine still pins the old one.
    const fresh = new VaultEncryption({
      vaultPath: () => vault,
      secrets: () => new VaultSecrets({ vaultPath: vault, machineStatePath: join(root, "other.json") }),
      keys: new VaultKeys({ vaultPath: () => vault, now: () => new Date(), isDeviceValid: () => true }),
      vault: {
        exclusive: (work) => Promise.resolve().then(work),
        pull: () => Promise.resolve(),
        encryptSecrets: () => Promise.resolve(),
        save: () => Promise.resolve(),
      },
      cost: { logN: 10 },
    });
    const secret = await fresh.unlock("other", password);
    await fresh.newKey("other", secret, "the other machine's password");
    expect(service.status(null, null).keyChanged).toBe(true);
    const mine = await service.unlock(token, "the other machine's password");
    await service.acceptKey(token, mine);
    expect(service.status(token, mine).keyChanged).toBe(false);
  });
});
