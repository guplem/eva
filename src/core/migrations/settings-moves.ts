/**
 * The first migrations: the shared settings moved from `config.json` into the vault, and the
 * security settings moved from the vault back to `config.json`. Each half that writes
 * a store is a migration of that store, because only the hub writes the vault.
 *
 * These migrations are frozen: they hold their own key lists and work on raw JSON, so a later
 * change to the settings code never changes what they do.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonTolerant } from "../../shared/files.ts";
import { parseConfig } from "../settings/home.ts";
import type { Migration } from "./migration-runner.ts";

/** The settings that the vault held on 2026-10-18. */
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

/** The settings that stayed on the machine on 2026-10-18. */
const securityKeys: readonly string[] = [
  "remoteAccess.allowedTailscaleIdentities",
  "trust",
  "google.readOnly",
  "google.services",
];

type JsonObject = Record<string, unknown>;

/** Each machine drops the shared keys from `config.json` once the vault has a settings file. */
export const moveSharedSettingsToVault: Migration = {
  id: "2026-10-18-move-shared-settings-to-vault",
  store: "machine",
  run: (context) => {
    const machine = readObject(context.paths.config);
    if (machine === "broken") return "later";
    if (machine === null || Object.keys(pickKeys(machine, sharedKeys)).length === 0) return "done";
    const vaultPath = context.vaultPath;
    if (vaultPath === null) return "done";
    if (!existsSync(vaultPath)) return "later";
    // Until the hub starts the vault's file, the values in config.json still apply.
    if (!existsSync(settingsFile(vaultPath))) return "later";
    context.write(context.paths.config, toJson(omitKeys(machine, sharedKeys)));
    return "done";
  },
};

/** The hub starts the vault's settings file from its own `config.json`. An existing file wins. */
export const startVaultSettings: Migration = {
  id: "2026-10-18-start-vault-settings",
  store: "vault",
  run: (context) => {
    if (context.vaultPath === null) return "done";
    const file = settingsFile(context.vaultPath);
    if (existsSync(file)) return "done";
    const machine = readObject(context.paths.config);
    if (machine === "broken") return "later";
    const shared = machine === null ? {} : pickKeys(machine, sharedKeys);
    if (Object.keys(shared).length === 0) return "done";
    context.write(file, toJson(shared));
    return "done";
  },
};

/**
 * Each machine copies the security keys that its `config.json` lacks from the vault file. The owner
 * or an earlier move wrote those values. A bad value is dropped, so Eva still starts.
 */
export const copySecuritySettingsFromVault: Migration = {
  id: "2026-10-18-copy-security-settings-from-vault",
  store: "machine",
  run: (context) => {
    const machine = readObject(context.paths.config);
    if (machine === "broken") return "later";
    // Without a vault, it waits: a later setup can join a vault that still holds the keys.
    const vaultPath = context.vaultPath;
    if (machine === null || vaultPath === null) return "later";
    if (!existsSync(vaultPath)) return "later";
    const vault = readObject(settingsFile(vaultPath));
    if (vault === "broken") return "later";
    if (vault === null) return "done";
    const missing = securityKeys.filter((key) => Object.keys(pickKeys(machine, [key])).length === 0);
    const copied = pickKeys(vault, missing);
    if (Object.keys(copied).length === 0) return "done";
    const merged = merge(copied, machine);
    // A bad value in config.json would stop Eva at every start, so a bad vault value is dropped instead.
    if (isValidConfig(merged)) context.write(context.paths.config, toJson(merged));
    return "done";
  },
};

/** The hub drops the security keys from the vault file. Each machine copied them first. */
export const dropSecuritySettingsFromVault: Migration = {
  id: "2026-10-18-drop-security-settings-from-vault",
  store: "vault",
  run: (context) => {
    if (context.vaultPath === null) return "done";
    const file = settingsFile(context.vaultPath);
    const vault = readObject(file);
    if (vault === "broken") return "later";
    if (vault === null || Object.keys(pickKeys(vault, securityKeys)).length === 0) return "done";
    context.write(file, toJson(omitKeys(vault, securityKeys)));
    return "done";
  },
};

function settingsFile(vaultPath: string): string {
  return join(vaultPath, ".eva", "settings.json");
}

/** A JSON object, null for a missing file, or "broken" for a file that is not a JSON object. */
function readObject(path: string): JsonObject | null | "broken" {
  const read = readJsonTolerant(path);
  if (!read.ok) return read.reason === "missing" ? null : "broken";
  return isObject(read.value) ? read.value : "broken";
}

function isValidConfig(value: unknown): boolean {
  try {
    parseConfig(value, "config.json");
    return true;
  } catch {
    return false;
  }
}

/** Objects merge key by key; any other value replaces the old one. */
function merge(base: unknown, change: unknown): unknown {
  if (!isObject(base) || !isObject(change)) return change;
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(change)) {
    // config.json is raw JSON, so a key such as __proto__ must never reach an assignment.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    merged[key] = merge(base[key], value);
  }
  return merged;
}

function pickKeys(source: JsonObject, keys: readonly string[]): JsonObject {
  let picked: JsonObject = {};
  for (const key of keys) {
    const parts = key.split(".");
    let current: unknown = source;
    for (const part of parts) current = isObject(current) ? current[part] : undefined;
    if (current === undefined) continue;
    picked = merge(
      picked,
      parts.reduceRight<unknown>((inner, part) => ({ [part]: inner }), current),
    ) as JsonObject;
  }
  return picked;
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

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
