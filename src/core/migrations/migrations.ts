/**
 * Every migration that this Eva knows, and the gate on the vault files. The hub and the satellites
 * update at different times, so a computer that is behind must never write a vault format that
 * a newer Eva already migrated.
 */
import { EvaError } from "../../shared/errors.ts";
import type { HomePaths } from "../settings/home.ts";
import {
  migrationsAhead,
  runMigrations,
  vaultMigrationRecordPath,
  type Migration,
  type MigrationRun,
} from "./migration-runner.ts";
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

export interface StartMigrations {
  readonly machine: MigrationRun;
  /** Null on a satellite: only the hub runs the vault migrations, so two machines never race on them. */
  readonly vault: MigrationRun | null;
}

export interface StartMigrationsOptions {
  readonly paths: HomePaths;
  readonly vaultPath: string | null;
  /** Read after the machine migrations, which never change the role. */
  readonly isHub: () => boolean;
  readonly version: string;
  readonly now: () => Date;
  readonly list?: readonly Migration[];
}

/**
 * Runs the missing migrations at start, after the vault pull and before anything reads the files.
 * The machine store runs first, so each machine copies a vault value before the hub drops it.
 */
export function runStartMigrations(options: StartMigrationsOptions): StartMigrations {
  const common = { ...options, migrations: options.list ?? migrations };
  const machine = runMigrations({ ...common, store: "machine" });
  const vault = options.isHub() ? runMigrations({ ...common, store: "vault" }) : null;
  return { machine, vault };
}
