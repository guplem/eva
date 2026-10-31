import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readVaultKey, writeVaultKey } from "../../../../src/core/vault/secret-state.ts";
import { VaultEncryption } from "../../../../src/core/vault/vault-encryption.ts";
import {
  createVaultKey,
  encryptedState,
  encryptFile,
  keyFingerprint,
} from "../../../../src/core/vault/vault-crypto.ts";
import { VaultKeys } from "../../../../src/core/vault/vault-keys.ts";
import { VaultSecrets } from "../../../../src/core/vault/vault-secrets.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let root: string;
let vault: string;
let saves: number;
/** What the next pull answers: "offline" plays a computer that cannot reach the remote. */
let pullStatus: string;
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
      pull: () => Promise.resolve({ status: pullStatus }),
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
  pullStatus = "ok";
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the vault password (#707)", () => {
  test("a new password makes the vault's key once, pins it, and saves the vault", async () => {
    const service = encryption();
    expect(service.status(null, null)).toMatchObject({ hasKey: false, unlocked: false });
    await service.setPassword(token, password);
    const key = readVaultKey(vault);
    expect(key).not.toBeNull();
    expect(secrets.inputs().machine.fingerprint).toBe(keyFingerprint(key ?? { publicKey: "", signingKey: "" }));
    expect(saves).toBe(1);
    expect(isEvaError(await failure(() => service.setPassword(token, password)), "vault_key_invalid")).toBe(true);
  });

  test("a device unlocks, reads and saves an encrypted file, and Lock forgets it", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    write("deploy/id.key", "OLD\n");
    await service.setPatterns(null, null, { added: [], off: [] });
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
    await service.setPassword(token, password);
    write("deploy/id.key", "KEY\n");
    await service.setPatterns(null, null, { added: [], off: [] });
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
    await service.setPassword(token, password);
    write("Life/Health/blood.md", "Results.\n");
    await service.setPatterns(null, null, { added: ["Life/Health/**"], off: [] });
    expect(read(".eva/secret-files")).toContain("Life/Health/**");
    expect(encryptedState(new TextEncoder().encode(read("Life/Health/blood.md")))).toBe("encrypted");
  });

  test("a default turned off waits; only a confirmation from an unlocked device decrypts its files", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    write("deploy/id.key", "KEY\n");
    await service.setPatterns(null, null, { added: [], off: [] });
    await service.setPatterns(null, null, { added: [], off: ["*.key"] });
    expect(service.status(null, null).waiting).toEqual(["*.key"]);
    expect(encryptedState(new TextEncoder().encode(read("deploy/id.key")))).toBe("encrypted");
    expect(
      isEvaError(
        await failure(() =>
          service.confirmRemovals(token, "no secret", { patterns: ["*.key"], files: ["deploy/id.key"] }),
        ),
        "vault_locked",
      ),
    ).toBe(true);
    const secret = await service.unlock(token, password);
    expect(await service.confirmRemovals(token, secret, { patterns: ["*.key"], files: ["deploy/id.key"] })).toEqual([
      "deploy/id.key",
    ]);
    expect(read("deploy/id.key")).toBe("KEY\n");
    expect(service.status(null, null).waiting).toEqual([]);
    const defaults = service.status(null, null).defaults;
    expect(defaults.find((entry) => entry.pattern === "*.key")).toMatchObject({ on: false });
  });

  test("a key that changed on another machine waits until the person types its password here", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    // Another machine made a new key; this machine still pins the old one.
    const fresh = new VaultEncryption({
      vaultPath: () => vault,
      secrets: () => new VaultSecrets({ vaultPath: vault, machineStatePath: join(root, "other.json") }),
      keys: new VaultKeys({ vaultPath: () => vault, now: () => new Date(), isDeviceValid: () => true }),
      vault: {
        exclusive: (work) => Promise.resolve().then(work),
        pull: () => Promise.resolve({ status: "ok" }),
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

describe("a key file that an agent changes (review of #707)", () => {
  test("a save from a device unlocked with the old key is refused, and the new key needs its own password", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    write("deploy/id.key", "KEY\n");
    await service.setPatterns(null, null, { added: [], off: [] });
    const secret = await service.unlock(token, password);
    const version = (service.readFile(token, secret, "deploy/id.key") as { version: string }).version;
    // An agent swaps in a key of its own.
    writeVaultKey(vault, await createVaultKey("the agent's own password", { logN: 10 }));
    expect(await failure(() => service.saveFile(token, secret, "deploy/id.key", "NEW\n", version))).not.toBeNull();
    expect(isEvaError(await failure(() => service.acceptKey(token, secret)), "vault_locked")).toBe(true);
    expect(service.status(null, null).keyChanged).toBe(true);
  });

  test("a broken key file is never replaced by a new password, so its files stay recoverable", async () => {
    const service = encryption();
    write(".eva/vault-key.json", '{"version": 2, "publicKey": "from a newer Eva"}\n');
    expect(isEvaError(await failure(() => service.setPassword(token, password)), "vault_key_invalid")).toBe(true);
    expect(read(".eva/vault-key.json")).toContain("from a newer Eva");
  });

  test("only a device sets the first password, never the local API token", async () => {
    const service = encryption();
    expect(isEvaError(await failure(() => service.setPassword(null, password)), "vault_locked")).toBe(true);
    expect(readVaultKey(vault)).toBeNull();
  });

  test("a new key changes nothing when a file does not open with the old key, and the old password then fails", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    const other = await createVaultKey("another long password", { logN: 10 });
    write(
      "deploy/foreign.key",
      new TextDecoder().decode(encryptFile(new TextEncoder().encode("X\n"), other, "deploy/foreign.key")),
    );
    const before = read(".eva/vault-key.json");
    let secret = await service.unlock(token, password);
    expect(
      isEvaError(await failure(() => service.newKey(token, secret, "a third long password")), "vault_file_unreadable"),
    ).toBe(true);
    expect(read(".eva/vault-key.json")).toBe(before);
    rmSync(join(vault, "deploy/foreign.key"));
    secret = await service.unlock(token, password);
    await service.newKey(token, secret, "a third long password");
    expect(isEvaError(await failure(() => service.unlock(token, password)), "vault_password_wrong")).toBe(true);
  });
});

describe("a key file that goes away (review of #707)", () => {
  test("a computer that knew a key never makes a second one, so the old files stay recoverable", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    rmSync(join(vault, ".eva", "vault-key.json"));
    const refused = await failure(() => service.setPassword(token, "a brand new password"));
    expect(isEvaError(refused, "vault_key_invalid")).toBe(true);
    expect(refused instanceof Error ? refused.message : "").toContain("Restore .eva/vault-key.json");
    expect(readVaultKey(vault)).toBeNull();
  });
});

describe("removals that the person confirms, after the review of #707", () => {
  async function keyRemoved(service: VaultEncryption): Promise<string> {
    await service.setPassword(token, password);
    write("deploy/id.key", "KEY\n");
    await service.setPatterns(null, null, { added: [], off: [] });
    await service.setPatterns(null, null, { added: [], off: ["*.key"] });
    return service.unlock(token, password);
  }

  test("a confirmation names its files, and a file that comes meanwhile stops it", async () => {
    const service = encryption();
    const secret = await keyRemoved(service);
    expect(service.status(token, secret).waitingFiles).toEqual(["deploy/id.key"]);
    const stale = await failure(() => service.confirmRemovals(token, secret, { patterns: ["*.key"], files: [] }));
    expect(isEvaError(stale, "file_changed")).toBe(true);
    expect(service.status(null, null).waiting).toEqual(["*.key"]);
    expect(await service.confirmRemovals(token, secret, { patterns: ["*.key"], files: ["deploy/id.key"] })).toEqual([
      "deploy/id.key",
    ]);
  });

  test("only the patterns that the person saw stop", async () => {
    const service = encryption();
    const secret = await keyRemoved(service);
    await service.setPatterns(token, secret, { added: [], off: ["*.key", "*.pem"] });
    expect(service.status(null, null).waiting).toEqual(["*.key", "*.pem"]);
    await service.confirmRemovals(token, secret, { patterns: ["*.key"], files: ["deploy/id.key"] });
    expect(service.status(null, null).waiting).toEqual(["*.pem"]);
  });

  test("a file that does not decrypt stops the confirmation, and nothing changes", async () => {
    const service = encryption();
    const secret = await keyRemoved(service);
    const other = await createVaultKey("another long password", { logN: 10 });
    write(
      "deploy/foreign.key",
      new TextDecoder().decode(encryptFile(new TextEncoder().encode("X\n"), other, "deploy/foreign.key")),
    );
    const files = service.status(token, secret).waitingFiles;
    const refused = await failure(() => service.confirmRemovals(token, secret, { patterns: ["*.key"], files }));
    expect(isEvaError(refused, "vault_file_unreadable")).toBe(true);
    expect(service.status(null, null).waiting).toEqual(["*.key"]);
    expect(encryptedState(new TextEncoder().encode(read("deploy/id.key")))).toBe("encrypted");
  });

  test("a pattern added back needs an unlocked device, and an agent that drops it again changes nothing", async () => {
    const service = encryption();
    const secret = await keyRemoved(service);
    await service.confirmRemovals(token, secret, { patterns: ["*.key"], files: ["deploy/id.key"] });
    const locked = await failure(() => service.setPatterns(null, null, { added: [], off: [] }));
    expect(isEvaError(locked, "vault_locked")).toBe(true);
    await service.setPatterns(token, secret, { added: [], off: [] });
    expect(encryptedState(new TextEncoder().encode(read("deploy/id.key")))).toBe("encrypted");
    // An agent turns the default off again, by hand.
    write(".eva/secret-files", "!*.key\n");
    expect(service.status(null, null).waiting).toEqual(["*.key"]);
  });

  test("a person's own pattern that the person saved from an unlocked device stays, though an agent drops its line", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    const secret = await service.unlock(token, password);
    await service.setPatterns(token, secret, { added: ["Life/Health/**"], off: [] });
    write(".eva/secret-files", "");
    rmSync(join(root, "state"), { recursive: true, force: true });
    expect(service.status(null, null).waiting).toContain("Life/Health/**");
  });
});

describe("the first password and the remote (second review of #707)", () => {
  test("a computer that cannot reach the remote makes no key, so two computers never make two", async () => {
    const service = encryption();
    pullStatus = "offline";
    const refused = await failure(() => service.setPassword(token, password));
    expect(isEvaError(refused, "vault_key_invalid")).toBe(true);
    expect(readVaultKey(vault)).toBeNull();
    pullStatus = "ok";
    await service.setPassword(token, password);
    expect(readVaultKey(vault)).not.toBeNull();
  });
});

describe("a save of the list after a confirmed removal (second review of #707)", () => {
  test("keeps the removal confirmed, so nothing waits again", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    write("deploy/id.key", "KEY\n");
    const secret = await service.unlock(token, password);
    await service.setPatterns(token, secret, { added: [], off: ["*.key"] });
    await service.confirmRemovals(token, secret, { patterns: ["*.key"], files: ["deploy/id.key"] });
    await service.setPatterns(token, secret, { added: ["Life/Health/**"], off: ["*.key"] });
    expect(service.status(null, null).waiting).toEqual([]);
    expect(read("deploy/id.key")).toBe("KEY\n");
  });
});

describe("a copy of an encrypted file under a freed name (second review of #707)", () => {
  test("is never decrypted by a removal, and the refusal names it", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    write("Life/Health/blood.md", "Results.\n");
    const secret = await service.unlock(token, password);
    await service.setPatterns(token, secret, { added: ["Life/Health/**"], off: [] });
    // An agent copies the encrypted note under a name that a removal frees.
    write("deploy/old.key", read("Life/Health/blood.md"));
    await service.setPatterns(token, secret, { added: ["Life/Health/**"], off: ["*.key"] });
    const files = service.status(token, secret).waitingFiles;
    expect(files).toEqual(["deploy/old.key"]);
    const refused = await failure(() => service.confirmRemovals(token, secret, { patterns: ["*.key"], files }));
    expect(isEvaError(refused, "vault_file_unreadable")).toBe(true);
    expect(refused instanceof Error ? refused.message : "").toContain("Life/Health/blood.md");
    expect(read("deploy/old.key")).not.toContain("Results.");
  });
});

describe("a line with ! in the person's patterns (second review of #707)", () => {
  test("is refused with a word on the switches, never dropped in silence", async () => {
    const service = encryption();
    await service.setPassword(token, password);
    const refused = await failure(() => service.setPatterns(null, null, { added: ["!*.key"], off: [] }));
    expect(isEvaError(refused, "config_invalid")).toBe(true);
    expect(refused instanceof Error ? refused.message : "").toContain("switch");
  });
});
