/**
 * The person's Eva settings in the vault live in one folder, `.eva/settings/` (#662). Until
 * 2026-10-30, `settings.json` and `chat-names.md` lived at the top of `.eva/`. The migration
 * `2026-11-22-delete-old-settings-files` deletes those old files (#685).
 */
import { join } from "node:path";

export function vaultSettingsFolder(vaultPath: string): string {
  return join(vaultPath, ".eva", "settings");
}
