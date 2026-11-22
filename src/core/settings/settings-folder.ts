/**
 * The person's Eva settings in the vault live in one folder, `.eva/settings/` (#662). Until
 * 2026-10-30, `settings.json` and `chat-names.md` lived at the top of `.eva/`. The hub moves them
 * at start, then deletes the old files (#685).
 *
 * Until the move, the old file holds the person's values. The move waits while the old settings
 * file is broken, and a vault can wait for a hub that has not updated yet. So until then, Eva reads
 * the old file and writes both places. After the move, only the new place counts.
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

function moved(file: VaultSettingsFile): boolean {
  return migrationApplied(vaultMigrationRecordPath(file.vaultPath), moveSettingsToFolder.id);
}

/** The place to read. After the move, a deleted new file never brings back old values. */
export function readablePath(file: VaultSettingsFile): string {
  return !moved(file) && existsSync(file.oldPath) ? file.oldPath : file.path;
}

/**
 * Writes the new place, and the old place until the move. The move copies the old file over the
 * new one, so a save that skipped it would be lost. The old place is written even when it is
 * missing: the hub's first start can still create it from its own `config.json`, and then finds it.
 * The old place goes first: a stop between the writes keeps the newest value where Eva reads it.
 */
export function writeSettingsFile(file: VaultSettingsFile, content: string): void {
  if (!moved(file)) writeFileAtomic(file.oldPath, content);
  writeFileAtomic(file.path, content);
}
