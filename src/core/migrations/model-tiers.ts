/**
 * The model tiers (#550). `engines.claudeCode.defaultModel` became `engines.defaultModel`, for every
 * engine, and its `default` became `opus`, the Smart tier. pi's one `default` model fills each tier
 * that names no model, so a pi chat keeps its model. Each store changes in its own migration,
 * because only the hub writes the vault.
 *
 * These migrations are frozen: they hold their own tier list and work on raw JSON.
 */
import { join } from "node:path";
import { readJsonTolerant } from "../../shared/files.ts";
import { parseConfig } from "../settings/home.ts";
import type { Migration, MigrationContext } from "./migration-runner.ts";

/** The tiers on 2026-10-24. */
const tiers = ["opus", "sonnet", "haiku"] as const;

type JsonObject = Record<string, unknown>;

export const modelTiersInVault: Migration = {
  id: "2026-10-24-model-tiers-in-vault",
  store: "vault",
  run: (context) => {
    if (context.vaultPath === null) return "done";
    return migrateFile(context, join(context.vaultPath, ".eva", "settings.json"));
  },
};

export const modelTiersInConfig: Migration = {
  id: "2026-10-24-model-tiers-in-config",
  store: "machine",
  run: (context) => migrateFile(context, context.paths.config),
};

function migrateFile(context: MigrationContext, path: string): "done" | "later" {
  const read = readJsonTolerant(path);
  if (!read.ok) return read.reason === "missing" ? "done" : "later";
  const settings = read.value;
  if (!isObject(settings) || !isObject(settings["engines"])) return isObject(settings) ? "done" : "later";
  const engines = settings["engines"];
  const migrated = withTiers(engines);
  if (migrated === engines) return "done";
  const changed = { ...settings, engines: migrated };
  // Eva does not start with a bad file. The migration runs again after the person fixes it.
  if (!isValidConfig(changed)) return "later";
  context.write(path, JSON.stringify(changed, null, 2) + "\n");
  return "done";
}

/** The same object when nothing changes. */
function withTiers(engines: JsonObject): JsonObject {
  let changed = engines;
  const claudeCode = engines["claudeCode"];
  if (isObject(claudeCode) && "defaultModel" in claudeCode) {
    const { defaultModel: old, ...rest } = claudeCode;
    changed = { ...changed, claudeCode: rest, defaultModel: old === "default" ? "opus" : old };
  }
  const pi = engines["pi"];
  const models = isObject(pi) ? pi["models"] : undefined;
  if (isObject(pi) && isObject(models) && "default" in models) {
    const { default: old, ...rest } = models;
    const filled = Object.fromEntries(tiers.map((tier) => [tier, rest[tier] ?? old]));
    changed = { ...changed, pi: { ...pi, models: filled } };
  }
  return changed;
}

function isValidConfig(value: unknown): boolean {
  try {
    parseConfig(value, "settings");
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
