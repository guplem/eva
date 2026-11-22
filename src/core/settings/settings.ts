/**
 * The settings of a person live in the vault, in `.eva/settings/settings.json`, so every machine with the
 * vault uses the same ones. The settings of one machine, such as the vault folder,
 * the port and the program paths, stay in the home's `config.json`. Secrets never go in the vault.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { vaultSettingsFolder } from "./settings-folder.ts";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { defaultConfig, parseConfig, saveConfig, type EvaConfig, type HomePaths } from "./home.ts";
import { withMachineDefaults } from "./machine-defaults.ts";
import { assertVaultWritable, vaultAhead } from "../migrations/migrations.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";

/** The settings that the vault holds, as dotted keys. Every other key belongs to the machine. */
export const sharedSettingKeys: readonly string[] = [
  "timeZone",
  "language",
  "units",
  "clock",
  "weekStart",
  "sync.sweepSeconds",
  "sync.pullIntervalMinutes",
  "updates",
  "widgets.checkIntervalMinutes",
  "engines.default",
  "engines.defaultModel",
  "engines.defaultEffort",
  "engines.pi.models",
  "google.email",
  "voice.language",
  "outwardActions",
  "answerTimeouts",
];

/**
 * Vault keys from before a migration. Eva still reads them, so a satellite reads a vault that the hub
 * did not migrate yet. `parseConfig` moves each one to its new key.
 */
const oldSharedSettingKeys: readonly string[] = ["engines.claudeCode.defaultModel"];

type SettingsObject = Record<string, unknown>;

export interface LoadedSettings {
  readonly config: EvaConfig;
  /** Why the vault's settings file was not used, or null. */
  readonly problem: string | null;
}

export function vaultSettingsPath(vaultPath: string): string {
  return join(vaultSettingsFolder(vaultPath), "settings.json");
}

/** The machine's `config.json`, with the machine's own defaults, and the vault's settings on top. */
export function loadSettings(paths: HomePaths): LoadedSettings {
  const read = readJsonTolerant(paths.config);
  if (!read.ok && read.reason === "invalid") throw new EvaError("config_invalid", `${paths.config} is not valid JSON.`);
  const machine = read.ok ? parseConfig(read.value, paths.config) : defaultConfig;
  return withVaultSettings(withMachineDefaults(machine, { homeRoot: paths.root, exists: existsSync }));
}

/**
 * Puts the vault's settings on top of a config. A broken file in the vault, which can arrive from
 * another machine, never stops Eva: she keeps the config and names the problem (lesson 54).
 */
export function withVaultSettings(config: EvaConfig): LoadedSettings {
  if (config.vaultPath === null) return { config, problem: null };
  const file = vaultSettingsPath(config.vaultPath);
  const read = readJsonTolerant(file);
  if (!read.ok && read.reason === "missing") return { config, problem: unmovedSettingsProblem(config.vaultPath) };
  if (!read.ok) return { config, problem: `${file} is not valid JSON.` };
  if (!isObject(read.value)) return { config, problem: `${file} does not hold a JSON object.` };
  try {
    const vaultSettings = pickKeys(read.value, [...sharedSettingKeys, ...oldSharedSettingKeys]);
    return { config: parseConfig(mergeSettings(config, vaultSettings), file), problem: null };
  } catch (error) {
    return { config, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** The settings file from before #662, and the migration that moves it into `.eva/settings/`. */
const oldSettingsName = "settings.json";
const settingsFolderMigrationId = "2026-10-30-settings-folder";

/**
 * True while the hub has not moved the old settings file. The move waits while that file is broken
 * or holds a bad value, so the file can stay for a long time (#685).
 */
function settingsFileUnmoved(vaultPath: string): boolean {
  if (!existsSync(join(vaultPath, ".eva", oldSettingsName))) return false;
  return !migrationApplied(vaultMigrationRecordPath(vaultPath), settingsFolderMigrationId);
}

/** Eva names an old file that waits, so it never hides the person's settings without a word. */
function unmovedSettingsProblem(vaultPath: string): string | null {
  if (!settingsFileUnmoved(vaultPath)) return null;
  return "The hub did not move .eva/settings.json into .eva/settings/, because the file is broken or holds a bad value. So Eva uses the default settings. Ask Eva to fix the file, then restart Eva on the hub.";
}

/**
 * Writes the vault's part to the vault and the rest to `config.json`. Without a vault, all of it goes
 * to `config.json`. A change to the vault's part fails with `vault_ahead` when a newer Eva migrated the vault.
 */
export function saveSettings(paths: HomePaths, config: EvaConfig): void {
  const vaultPath = config.vaultPath;
  if (vaultPath === null || !existsSync(vaultPath)) {
    saveConfig(paths, config);
    return;
  }
  const machine = omitKeys(config, sharedSettingKeys);
  const ahead = vaultAhead(vaultPath) !== null;
  if (ahead) {
    // A newer Eva migrated the vault, so its file stays as it is. A save that would need a change to it fails.
    const shared = (settings: EvaConfig): string => JSON.stringify(pickKeys(settings, sharedSettingKeys));
    const after = withVaultSettings(parseConfig(machine, paths.config)).config;
    if (shared(after) !== shared(config)) assertVaultWritable(vaultPath);
  }
  writeFileAtomic(paths.config, toJson(machine));
  if (!ahead) {
    const file = vaultSettingsPath(vaultPath);
    const shared = pickKeys(config, sharedSettingKeys);
    const content = toJson({ ...shared, ...unknownVaultKeys(file) });
    // The move copies the old file over the new one, so the save goes there too, and repairs it.
    if (settingsFileUnmoved(vaultPath)) writeFileAtomic(join(vaultPath, ".eva", oldSettingsName), content);
    writeFileAtomic(file, content);
  }
}

/**
 * The top-level keys of the vault's file that this Eva does not know, such as a setting that a
 * newer satellite added. They stay, so an older hub's save never drops them.
 */
function unknownVaultKeys(file: string): SettingsObject {
  const read = readJsonTolerant(file);
  if (!read.ok || !isObject(read.value)) return {};
  return Object.fromEntries(Object.entries(read.value).filter(([key]) => !(key in defaultConfig)));
}

/** A config with a change, such as `{ updates: { frequency: "weekly" } }`, on top. Throws on a bad value. */
export function applySettingsChange(config: EvaConfig, change: Readonly<SettingsObject>): EvaConfig {
  return parseConfig(mergeSettings(config, change), "The settings change");
}

/** Checks a change and saves it, for a command that runs while Eva is stopped. */
export function changeSettings(paths: HomePaths, change: Readonly<SettingsObject>): EvaConfig {
  const changed = applySettingsChange(loadSettings(paths).config, change);
  saveSettings(paths, changed);
  return changed;
}

/** True for a dotted key that names a setting, such as `updates.frequency`. */
export function isSettingKey(key: string): boolean {
  let current: unknown = defaultConfig;
  for (const part of key.split(".")) {
    if (!isObject(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

/** True when the vault holds this setting, so it applies on every machine. */
export function isSharedSettingKey(key: string): boolean {
  return [...sharedSettingKeys, ...oldSharedSettingKeys].some(
    (shared) => key === shared || key.startsWith(`${shared}.`),
  );
}

/** The change for one dotted key. The value is JSON when it parses as JSON, and text otherwise. */
export function settingChange(key: string, value: string): SettingsObject {
  // An old key still works for one release: `parseConfig` moves it to its new key.
  if (!isSettingKey(key) && !oldSharedSettingKeys.includes(key))
    throw new EvaError("config_invalid", `${key} is not a setting.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }
  return key.split(".").reduceRight<unknown>((inner, part) => ({ [part]: inner }), parsed) as SettingsObject;
}

/** Every setting as one `key = value` line, with where it lives. */
export function describeSettings(config: EvaConfig): string[] {
  return leaves(config, "").map(
    ([key, value]) => `${key} = ${JSON.stringify(value)}${isSharedSettingKey(key) ? "  (vault)" : ""}`,
  );
}

function leaves(value: unknown, prefix: string): [string, unknown][] {
  if (!isObject(value)) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, inner]) => leaves(inner, prefix === "" ? key : `${prefix}.${key}`));
}

/** Objects merge key by key; any other value, an array included, replaces the old one. */
function mergeSettings(base: unknown, change: unknown): unknown {
  if (!isObject(base) || !isObject(change)) return change;
  const merged: SettingsObject = { ...base };
  for (const [key, value] of Object.entries(change)) merged[key] = mergeSettings(base[key], value);
  return merged;
}

function pickKeys(source: unknown, keys: readonly string[]): SettingsObject {
  let picked: SettingsObject = {};
  for (const key of keys) {
    const parts = key.split(".");
    let current: unknown = source;
    for (const part of parts) current = isObject(current) ? current[part] : undefined;
    if (current === undefined) continue;
    picked = mergeSettings(
      picked,
      parts.reduceRight<unknown>((inner, part) => ({ [part]: inner }), current),
    ) as SettingsObject;
  }
  return picked;
}

function omitKeys(source: SettingsObject, keys: readonly string[]): SettingsObject {
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

function isObject(value: unknown): value is SettingsObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
