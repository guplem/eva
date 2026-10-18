/**
 * Every migration that this Eva knows, and the gate on the vault files. The hub and the satellites
 * update at different times, so a computer that is behind must never write a vault format that
 * a newer Eva already migrated.
 */
import { EvaError } from "../../shared/errors.ts";
import { migrationsAhead, vaultMigrationRecordPath, type Migration } from "./migration-runner.ts";
import {
  copySecuritySettingsFromVault,
  dropSecuritySettingsFromVault,
  moveSharedSettingsToVault,
  startVaultSettings,
} from "./settings-moves.ts";

/** Add each new migration here. The runner sorts them by id. */
export const migrations: readonly Migration[] = [
  moveSharedSettingsToVault,
  startVaultSettings,
  copySecuritySettingsFromVault,
  dropSecuritySettingsFromVault,
];

export interface VaultAhead {
  /** The vault migrations that a newer Eva ran and this one does not know. */
  readonly unknown: string[];
  /** The version that ran the newest of them, or null when the record does not say. */
  readonly version: string | null;
}

/** Null when this Eva knows every migration that the vault's record lists. */
export function vaultAhead(vaultPath: string): VaultAhead | null {
  const known = migrations.filter((migration) => migration.store === "vault").map((migration) => migration.id);
  return migrationsAhead(vaultMigrationRecordPath(vaultPath), known);
}

/**
 * Throws `vault_ahead` when a newer Eva migrated the vault. It reads the record at each call,
 * because a pull can bring a new record at any time.
 */
export function assertVaultWritable(vaultPath: string): void {
  const ahead = vaultAhead(vaultPath);
  if (ahead === null) return;
  throw new EvaError(
    "vault_ahead",
    `The vault needs Eva ${ahead.version ?? "of a newer version"} or later. Update Eva on this computer first.`,
  );
}
