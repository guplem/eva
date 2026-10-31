/**
 * The files that hold the state of the vault's encryption (#707):
 * - `.eva/vault-key.json` in the vault: the public keys and the wrapped private keys.
 * - `.eva/secret-files.sig.json` in the vault: the last removal that the person confirmed, signed.
 * - `vault-secrets.json` in the machine's state folder: the key's fingerprint, the highest sequence
 *   that this machine accepted, and every pattern that it ever applied.
 *
 * Their formats are a schema. Each read is tolerant: a missing or broken file reads as the safe
 * state, in which Eva encrypts more, never less.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { keyFingerprint, signRecord, verifyRecord, type UnlockedVaultKey, type VaultKeyFile } from "./vault-crypto.ts";
import type { SignedSecretState } from "./secret-policy.ts";

export const vaultKeyPath = ".eva/vault-key.json";
export const signedStatePath = ".eva/secret-files.sig.json";

const keyFileSchema = z.object({
  version: z.literal(1),
  publicKey: z.string(),
  signingKey: z.string(),
  kdf: z.object({
    name: z.literal("scrypt"),
    logN: z.number().int(),
    r: z.number().int(),
    p: z.number().int(),
    salt: z.string(),
  }),
  wrappedPrivateKey: z.string(),
}) satisfies z.ZodType<VaultKeyFile>;

const signedFileSchema = z.object({ version: z.literal(1), payload: z.string(), signature: z.string() });

const payloadSchema = z.object({
  sequence: z.number().int().min(0),
  fingerprint: z.string(),
  known: z.array(z.string()),
  active: z.array(z.string()),
}) satisfies z.ZodType<SignedSecretState>;

const machineSchema = z.object({
  fingerprint: z.string().nullable(),
  sequence: z.number().int().min(0),
  applied: z.array(z.string()),
});

export type MachineSecrets = z.infer<typeof machineSchema>;

/** The vault's key file, or null when there is none or Eva cannot read it. */
export function readVaultKey(vaultPath: string): VaultKeyFile | null {
  const read = readJsonTolerant(join(vaultPath, vaultKeyPath));
  if (!read.ok) return null;
  const parsed = keyFileSchema.safeParse(read.value);
  return parsed.success ? parsed.data : null;
}

export function writeVaultKey(vaultPath: string, file: VaultKeyFile): void {
  writeJson(join(vaultPath, vaultKeyPath), file);
}

/**
 * The confirmed removal, or null when there is none, or when it is not signed by this key, names
 * another key, or is older than one that this machine already accepted.
 */
export function readSignedState(
  vaultPath: string,
  key: VaultKeyFile,
  lowestSequence: number,
): SignedSecretState | null {
  const read = readJsonTolerant(join(vaultPath, signedStatePath));
  if (!read.ok) return null;
  const file = signedFileSchema.safeParse(read.value);
  // The signature covers the payload's exact text, so no canonical form of the JSON is needed.
  if (!file.success || !verifyRecord(file.data.payload, file.data.signature, key)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(file.data.payload);
  } catch {
    return null;
  }
  const state = payloadSchema.safeParse(payload);
  if (!state.success) return null;
  if (state.data.fingerprint !== keyFingerprint(key) || state.data.sequence < lowestSequence) return null;
  return state.data;
}

/** Signs the state with the unlocked key and writes it to the vault. */
export function writeSignedState(vaultPath: string, state: SignedSecretState, unlocked: UnlockedVaultKey): void {
  const payload = JSON.stringify(state);
  writeJson(join(vaultPath, signedStatePath), { version: 1, payload, signature: signRecord(payload, unlocked) });
}

/** This machine's memory. A missing or broken file reads as a machine that knows nothing yet. */
export function readMachineSecrets(path: string): MachineSecrets {
  const read = readJsonTolerant(path);
  const parsed = read.ok ? machineSchema.safeParse(read.value) : null;
  return parsed?.success === true ? parsed.data : { fingerprint: null, sequence: 0, applied: [] };
}

export function writeMachineSecrets(path: string, value: MachineSecrets): void {
  writeJson(path, value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
