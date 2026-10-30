/**
 * On 2026-10-30 the person's Eva settings in the vault moved into one folder, `.eva/settings/` (#662).
 * This migration copies each old file to its new place. The old files stay for one release: an
 * older satellite reads only those, and the `vault_ahead` gate stops it from a write.
 *
 * The migration is frozen: it holds its own list of the moved files.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant } from "../../shared/files.ts";
import type { Migration } from "./migration-runner.ts";

/** The files that moved on 2026-10-30, by their name in `.eva/`. */
const movedFiles: readonly string[] = ["settings.json", "chat-names.md"];

export const moveSettingsToFolder: Migration = {
  id: "2026-10-30-settings-folder",
  store: "vault",
  run: (context) => {
    if (context.vaultPath === null) return "done";
    // The older migrations clean the old settings file once it is valid again. A copy now would skip that.
    const settings = readJsonTolerant(join(context.vaultPath, ".eva", "settings.json"));
    if (!settings.ok && settings.reason !== "missing") return "later";
    for (const name of movedFiles) {
      const old = join(context.vaultPath, ".eva", name);
      if (!existsSync(old)) continue;
      // Until this migration runs, Eva reads the old place and writes both, so the old file is the newest.
      context.write(join(context.vaultPath, ".eva", "settings", name), readFileSync(old, "utf-8"));
    }
    return "done";
  },
};
