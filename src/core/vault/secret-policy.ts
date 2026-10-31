/**
 * Which secret patterns apply now (#707). The person asks for patterns in the vault, where an agent
 * can also write. So a pattern starts to apply at once, from any source, but stops only when the
 * person confirms it from an unlocked device: a signed record names the patterns that stay. Eva
 * then encrypts more, never less, when the record is missing, broken or old.
 */
import type { SecretFilesChanges } from "./secret-files.ts";

/** The record that an unlocked device signs when the person confirms a removal. */
export interface SignedSecretState {
  /** Grows with each confirmation, so an older record copied from git history does nothing. */
  readonly sequence: number;
  /** The key that signed it. A record of an old key does nothing after "New key". */
  readonly fingerprint: string;
  /** Every pattern that Eva knew when the person confirmed. A pattern that it did not know is new. */
  readonly known: readonly string[];
  /** The patterns that stay. */
  readonly active: readonly string[];
}

export interface SecretPolicyInput {
  /** The defaults of this version of Eva. */
  readonly defaults: readonly string[];
  /** The defaults that a release took out. They apply until a signed removal. */
  readonly retired: readonly string[];
  /** The person's file of changes. */
  readonly changes: SecretFilesChanges;
  /** A valid signed record, or null. */
  readonly signed: SignedSecretState | null;
  /** Each pattern that this machine ever applied, kept in its state folder. */
  readonly applied: readonly string[];
}

export interface SecretPolicy {
  /** The patterns that Eva encrypts now, sorted. */
  readonly active: readonly string[];
  /** The patterns that apply, but that the person's file no longer asks for: removals that wait. */
  readonly waiting: readonly string[];
}

export function activeSecretPatterns(input: SecretPolicyInput): SecretPolicy {
  const desired = desiredPatterns(input);
  const candidates = new Set([...desired, ...input.defaults, ...input.retired, ...input.applied]);
  const removed = (pattern: string): boolean =>
    input.signed !== null && input.signed.known.includes(pattern) && !input.signed.active.includes(pattern);
  const active = [...candidates].filter((pattern) => desired.has(pattern) || !removed(pattern)).sort();
  return { active, waiting: active.filter((pattern) => !desired.has(pattern)) };
}

/** What an unlocked device signs to confirm every removal that waits. */
export function signedPayload(input: SecretPolicyInput, sequence: number, fingerprint: string): SignedSecretState {
  const desired = desiredPatterns(input);
  const known = new Set([...desired, ...input.defaults, ...input.retired, ...input.applied]);
  return { sequence, fingerprint, known: [...known].sort(), active: [...desired].sort() };
}

/** The defaults that the file does not turn off, and the patterns that it adds. */
function desiredPatterns(input: SecretPolicyInput): Set<string> {
  const off = new Set(input.changes.off);
  return new Set([...input.defaults.filter((pattern) => !off.has(pattern)), ...input.changes.added]);
}
