/**
 * `google.readOnly` gave every Google service the same access. `google.access` holds one level for
 * each service (#264). Write access becomes the top level of each service: it asks for the same
 * scopes as before, so the old login still fits.
 *
 * This migration is frozen: it holds its own level list and works on raw JSON.
 */
import { existsSync } from "node:fs";
import { readJsonTolerant } from "../../shared/files.ts";
import { parseConfig } from "../settings/home.ts";
import type { Migration } from "./migration-runner.ts";

/** The top level of each service on 2026-10-20. */
const topLevels = { calendar: "full", drive: "full", contacts: "full", tasks: "full", gmail: "full" };

type JsonObject = Record<string, unknown>;

export const googleAccessPerService: Migration = {
  id: "2026-10-20-google-access-per-service",
  store: "machine",
  run: (context) => {
    const read = readJsonTolerant(context.paths.config);
    if (!read.ok && read.reason !== "missing") return "later";
    const machine = read.ok ? read.value : {};
    if (!isObject(machine)) return "later";
    const google = machine["google"];
    if (!isObject(google) || !("readOnly" in google)) {
      // The 2026-10-18 copy migration can still bring `readOnly` from a vault that joins later.
      const vaultPath = context.vaultPath;
      return vaultPath === null || !existsSync(vaultPath) ? "later" : "done";
    }
    const { readOnly, ...rest } = google;
    const access = isObject(rest["access"]) ? rest["access"] : {};
    // Only `false` gave write access. A bad value falls back to the default, read only.
    const migrated = readOnly === false ? { ...rest, access: { ...topLevels, ...access } } : rest;
    const changed = { ...machine, google: migrated };
    // Eva does not start with a bad file. The migration runs again after the person fixes it.
    if (!isValidConfig(changed)) return "later";
    context.write(context.paths.config, JSON.stringify(changed, null, 2) + "\n");
    return "done";
  },
};

function isValidConfig(value: unknown): boolean {
  try {
    parseConfig(value, "config.json");
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
