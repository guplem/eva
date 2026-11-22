/**
 * #662 moved `.eva/settings.json` and `.eva/chat-names.md` into `.eva/settings/`. For one release,
 * Eva kept the old files too, because an older satellite read only them. That release passed, so
 * the hub now deletes them (#685).
 *
 * Two frozen machine migrations wait while the vault has no `.eva/settings.json`:
 * `2026-10-18-move-shared-settings-to-vault` and `2026-10-24-model-tiers-in-config`. After the delete,
 * they would wait forever, and `config.json` would keep old values. So a new machine migration drops
 * the same keys once the vault has a settings file in either place. Both old migrations then find
 * nothing to change, and finish at the next start.
 *
 * These migrations are frozen: they hold their own file and key lists, and work on raw JSON.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { migrationBackupPath, type Migration } from "./migration-runner.ts";

type JsonObject = Record<string, unknown>;

/** The files that moved on 2026-10-30, by their name in `.eva/`. */
const oldFiles: readonly string[] = ["settings.json", "chat-names.md"];
const settingsFolderId = "2026-10-30-settings-folder";

/**
 * The settings that the vault held on 2026-10-18. They hold the only keys that the old tier
 * migration changes in `config.json`: `engines.claudeCode.defaultModel` and `engines.pi.models`.
 */
const sharedKeys: readonly string[] = [
  "timeZone",
  "sync.sweepSeconds",
  "sync.pullIntervalMinutes",
  "updates",
  "engines.default",
  "engines.claudeCode.defaultModel",
  "engines.pi.models",
  "google.email",
  "voice.language",
];

export const deleteOldSettingsFiles: Migration = {
  id: "2026-11-22-delete-old-settings-files",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null) return "done";
    // Before the move, the old files hold the only copy of the person's settings.
    if (!settingsFolderDone(vaultPath)) return "later";
    for (const name of oldFiles) {
      const path = join(vaultPath, ".eva", name);
      if (!existsSync(path)) continue;
      // The runner keeps a copy only of a file that it writes, so a delete keeps its own.
      const backup = migrationBackupPath(context.paths, deleteOldSettingsFiles, join(".eva", name));
      if (!existsSync(backup)) writeFileAtomic(backup, readFileSync(path, "utf-8"));
      rmSync(path, { force: true });
    }
    return "done";
  },
};

/** Each machine drops the old shared keys from `config.json` once the vault has a settings file. */
export const dropOldSharedKeysFromConfig: Migration = {
  id: "2026-11-22-drop-old-shared-keys-from-config",
  store: "machine",
  run: (context) => {
    const read = readJsonTolerant(context.paths.config);
    if (!read.ok) return read.reason === "missing" ? "done" : "later";
    const machine = read.value;
    if (!isObject(machine)) return "later";
    const kept = omitKeys(machine, sharedKeys);
    if (JSON.stringify(kept) === JSON.stringify(machine)) return "done";
    const vaultPath = context.vaultPath;
    if (vaultPath === null) return "done";
    if (!existsSync(vaultPath)) return "later";
    // Until the hub starts the vault's file, the values in config.json still apply.
    if (!hasSettingsFile(vaultPath)) return "later";
    context.write(context.paths.config, JSON.stringify(kept, null, 2) + "\n");
    return "done";
  },
};

function hasSettingsFile(vaultPath: string): boolean {
  return (
    existsSync(join(vaultPath, ".eva", "settings", "settings.json")) ||
    existsSync(join(vaultPath, ".eva", "settings.json"))
  );
}

/** True once the settings folder migration is in the vault's record. A broken record counts as not yet. */
function settingsFolderDone(vaultPath: string): boolean {
  const read = readJsonTolerant(join(vaultPath, ".eva", "migrations.json"));
  if (!read.ok || !isObject(read.value)) return false;
  const applied = read.value["applied"];
  return Array.isArray(applied) && applied.some((entry) => isObject(entry) && entry["id"] === settingsFolderId);
}

function omitKeys(source: JsonObject, keys: readonly string[]): JsonObject {
  const copy = structuredClone(source);
  for (const key of keys) removeKey(copy, key.split("."));
  return copy;
}

/** Removes a dotted key, and each parent object that the removal leaves empty. */
function removeKey(parent: unknown, parts: readonly string[]): void {
  const [first, ...rest] = parts;
  if (!isObject(parent) || first === undefined) return;
  if (rest.length === 0) {
    Reflect.deleteProperty(parent, first);
    return;
  }
  removeKey(parent[first], rest);
  const child = parent[first];
  if (isObject(child) && Object.keys(child).length === 0) Reflect.deleteProperty(parent, first);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
