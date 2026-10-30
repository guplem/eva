/**
 * The person's Eva settings in the vault live in one folder, `.eva/settings/` (#662). Until
 * 2026-10-30, `settings.json` and `chat-names.md` lived at the top of `.eva/`. For one release, Eva
 * keeps those old files too, because an older satellite reads only them. Remove the old places one
 * release after #662.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../../shared/files.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";
import { moveSettingsToFolder } from "../migrations/settings-folder.ts";

export interface VaultSettingsFile {
  readonly vaultPath: string;
  /** The place in `.eva/settings/`. */
  readonly path: string;
  /** The place before 2026-10-30. */
  readonly oldPath: string;
}

export function vaultSettingsFolder(vaultPath: string): string {
  return join(vaultPath, ".eva", "settings");
}

/** A file of the settings folder that also had an old place, such as `chat-names.md`. */
export function movedSettingsFile(vaultPath: string, name: string): VaultSettingsFile {
  return { vaultPath, path: join(vaultSettingsFolder(vaultPath), name), oldPath: join(vaultPath, ".eva", name) };
}

/**
 * The place to read. Until the hub moves the files, an older Eva can still write the old place, so it
 * holds the newest value. A vault without the old file, such as a new one, reads the new place.
 * After the move, only the new place counts, so a deleted file never brings back old values.
 */
export function readablePath(file: VaultSettingsFile): string {
  if (migrationApplied(vaultMigrationRecordPath(file.vaultPath), moveSettingsToFolder.id)) return file.path;
  return existsSync(file.oldPath) || !existsSync(file.path) ? file.oldPath : file.path;
}

/** True when either place holds the file. */
export function settingsFileExists(file: VaultSettingsFile): boolean {
  return existsSync(file.path) || existsSync(file.oldPath);
}

/**
 * Writes both places, so an older satellite reads the new value too. The old place goes first: before
 * the move, Eva reads it, so a stop between the two writes keeps the newest value where Eva reads.
 */
export function writeSettingsFile(file: VaultSettingsFile, content: string): void {
  writeFileAtomic(file.oldPath, content);
  writeFileAtomic(file.path, content);
}
