/**
 * Every migration that this Eva knows, and the gate on the vault files. The computers that share a
 * vault update at different times. A computer that is behind must never write a vault format that a
 * newer Eva migrated.
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
import { moveAssistantPersonality } from "./assistant-rules-move.ts";
import {
  copySecuritySettingsFromVault,
  dropSecuritySettingsFromVault,
  moveSharedSettingsToVault,
  startVaultSettings,
} from "./settings-moves.ts";
import { googleAccessPerService } from "./google-access.ts";
import { addAboutMeHeader } from "./about-me-header.ts";
import { deleteOldCloneFolders } from "./clone-folders.ts";
import { modelTiersInConfig, modelTiersInVault } from "./model-tiers.ts";
import { moveSettingsToFolder } from "./settings-folder.ts";
import { describeProjectTypes } from "./project-types.ts";

/** Add each new migration here. The runner sorts them by id. */
export const migrations: readonly Migration[] = [
  moveSharedSettingsToVault,
  startVaultSettings,
  copySecuritySettingsFromVault,
  dropSecuritySettingsFromVault,
  googleAccessPerService,
  moveAssistantPersonality,
  addAboutMeHeader,
  deleteOldCloneFolders,
  modelTiersInVault,
  modelTiersInConfig,
  moveSettingsToFolder,
  describeProjectTypes,
];

export interface VaultAhead {
  /** The vault migrations that a newer Eva ran and this one does not know. */
  readonly unknown: string[];
  /** The version that ran the newest of them, or null when the record does not say. */
  readonly version: string | null;
  /** False when this Eva cannot read the record: it is damaged, or a newer Eva changed its shape. */
  readonly readable: boolean;
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
  throw new EvaError("vault_ahead", vaultAheadReason(ahead));
}

/** Why this Eva does not write the vault files, and what the person can do. */
function vaultAheadReason(ahead: VaultAhead): string {
  if (!ahead.readable)
    return "Eva cannot read .eva/migrations.json in the vault. Ask the Assistant to repair it, or update Eva on this computer.";
  return `The vault needs ${ahead.version === null ? "a newer Eva" : `Eva ${ahead.version}`}. Update Eva on this computer first.`;
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
  /** Every migration that this Eva knows. Tests pass their own list. */
  readonly migrations?: readonly Migration[];
}

/**
 * Runs the missing migrations at start, after the vault pull and before anything reads the files.
 * The machine store runs first, so each machine copies a vault value before the hub drops it.
 */
export function runStartMigrations(options: StartMigrationsOptions): StartMigrations {
  const common = { ...options, migrations: options.migrations ?? migrations };
  const machine = runMigrations({ ...common, store: "machine" });
  const vault = options.isHub() ? runMigrations({ ...common, store: "vault" }) : null;
  return { machine, vault };
}
