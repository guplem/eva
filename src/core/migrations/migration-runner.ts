/**
 * Migrations of stored files, as Prisma does for a database. Each format change comes with a
 * dated migration. Eva records the ids that ran, and runs the missing ones at start. The record
 * holds ids, not a counter, so two pull requests can merge in either order. Migrations only go
 * forward: Eva never installs an older version.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { HomePaths } from "../settings/home.ts";

/** The machine store is the home folder of an instance; the vault store syncs to every machine. */
export type MigrationStore = "machine" | "vault";

export interface MigrationContext {
  readonly paths: HomePaths;
  readonly vaultPath: string | null;
  /** Writes a file of the migration's store atomically, after a `.bak` copy of the old file. */
  write(path: string, content: string): void;
}

/**
 * "done" when the files have the new format, also when there was nothing to change. "later" when
 * the migration cannot run yet, such as before another machine wrote a file: it is not recorded.
 */
export type MigrationOutcome = "done" | "later";

export interface Migration {
  /** A dated id, such as `2026-10-20-move-sync-settings`. Never edit a migration that is on `main`. */
  readonly id: string;
  readonly store: MigrationStore;
  /** Changes the files, and is safe to run again after a stop halfway. Throws on a failure. */
  run(context: MigrationContext): MigrationOutcome;
}

export interface RunMigrationsOptions {
  readonly store: MigrationStore;
  /** Every migration that this Eva knows; the run takes those of its store. */
  readonly migrations: readonly Migration[];
  readonly paths: HomePaths;
  readonly vaultPath: string | null;
  /** The version of this Eva, which the record keeps. */
  readonly version: string;
  readonly now: () => Date;
}

export type MigrationRun =
  | { readonly kind: "done"; readonly applied: string[]; readonly later: string[] }
  /** The id is null when the record itself is broken. */
  | { readonly kind: "failed"; readonly applied: string[]; readonly id: string | null; readonly reason: string }
  /** The record lists ids that this Eva does not know: a newer Eva wrote it, so this one changes nothing. */
  | { readonly kind: "ahead"; readonly unknown: string[] };

interface AppliedMigration {
  readonly id: string;
  readonly at: string;
  readonly version: string;
}

export function vaultMigrationRecordPath(vaultPath: string): string {
  return join(vaultPath, ".eva", "migrations.json");
}

/**
 * Runs the missing migrations of one store in id order. A failure never throws: it is the result,
 * and it stops this store's run, because a later migration may expect the format of an earlier one.
 */
export function runMigrations(options: RunMigrationsOptions): MigrationRun {
  const { store, paths, vaultPath } = options;
  if (store === "vault" && vaultPath === null) return { kind: "done", applied: [], later: [] };
  const storeRoot = store === "machine" ? paths.root : (vaultPath ?? "");
  const recordPath = store === "machine" ? paths.migrations : vaultMigrationRecordPath(storeRoot);
  const record = readRecord(recordPath);
  if (record === null) return { kind: "failed", applied: [], id: null, reason: `${recordPath} is not valid JSON.` };
  const own = options.migrations.filter((migration) => migration.store === store);
  const knownIds = new Set(own.map((migration) => migration.id));
  const unknown = record.map((entry) => entry.id).filter((id) => !knownIds.has(id));
  if (unknown.length > 0) return { kind: "ahead", unknown };
  const done = new Set(record.map((entry) => entry.id));
  const missing = own.filter((migration) => !done.has(migration.id)).sort((a, b) => a.id.localeCompare(b.id));
  const applied: string[] = [];
  const later: string[] = [];
  let entries = record;
  for (const migration of missing) {
    const outcome = runOne(migration, storeRoot, paths, vaultPath);
    if (outcome.kind === "failed") return { kind: "failed", applied, id: migration.id, reason: outcome.reason };
    if (outcome.kind === "later") {
      later.push(migration.id);
      continue;
    }
    // Each id goes in the record at once, so a run that stops halfway repeats only the unrecorded ones.
    entries = [...entries, { id: migration.id, at: options.now().toISOString(), version: options.version }];
    writeFileAtomic(recordPath, JSON.stringify({ applied: entries }, null, 2) + "\n");
    applied.push(migration.id);
  }
  return { kind: "done", applied, later };
}

/**
 * The ids in a store's record that this Eva does not know, with the version that recorded the newest
 * one. Null when there are none, or the record is missing or broken.
 */
export function migrationsAhead(
  recordPath: string,
  knownIds: readonly string[],
): { unknown: string[]; version: string | null } | null {
  const record = readRecord(recordPath);
  if (record === null) return null;
  const known = new Set(knownIds);
  const unknown = record.filter((entry) => !known.has(entry.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (unknown.length === 0) return null;
  const newest = unknown.at(-1)?.version ?? "";
  return { unknown: unknown.map((entry) => entry.id), version: newest === "" ? null : newest };
}

/**
 * Where a migration keeps the copy of a file before its first change. The copies stay in the
 * machine's home, also for a vault file: a copy in the vault would sync, and it could hold the
 * security settings that a migration moves out of the vault.
 */
export function migrationBackupPath(paths: HomePaths, migration: Migration, pathInStore: string): string {
  return join(paths.stateFolder, "migration-backups", migration.id, migration.store, `${pathInStore}.bak`);
}

type OneRun = { kind: "done" | "later" } | { kind: "failed"; reason: string };

/** Runs one migration. On a failure, it puts back each file it changed. */
function runOne(migration: Migration, storeRoot: string, paths: HomePaths, vaultPath: string | null): OneRun {
  // Each file that the migration wrote, with its copy, or null when the file did not exist before.
  const touched = new Map<string, string | null>();
  const context: MigrationContext = {
    paths,
    vaultPath,
    write: (path, content) => {
      const inside = relative(storeRoot, path);
      if (inside === "" || inside.startsWith("..") || isAbsolute(inside))
        throw new Error(`A ${migration.store} migration cannot write ${path}.`);
      if (!touched.has(path)) {
        const backup = migrationBackupPath(paths, migration, inside);
        // A copy from a run that stopped halfway holds the original file, so it stays.
        if (existsSync(path) && !existsSync(backup)) writeFileAtomic(backup, readFileSync(path, "utf-8"));
        touched.set(path, existsSync(backup) ? backup : null);
      }
      writeFileAtomic(path, content);
    },
  };
  try {
    return { kind: migration.run(context) };
  } catch (error) {
    for (const [path, backup] of touched) {
      if (backup === null) rmSync(path, { force: true });
      else writeFileAtomic(path, readFileSync(backup, "utf-8"));
    }
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The applied migrations, an empty list for a missing file, or null for a broken one. */
function readRecord(path: string): AppliedMigration[] | null {
  const read = readJsonTolerant(path);
  if (!read.ok) return read.reason === "missing" ? [] : null;
  const applied = (read.value as { applied?: unknown } | null)?.applied;
  if (!Array.isArray(applied)) return null;
  return applied.flatMap((entry: unknown): AppliedMigration[] => {
    if (entry === null || typeof entry !== "object") return [];
    const { id, at, version } = entry as Partial<Record<keyof AppliedMigration, unknown>>;
    if (typeof id !== "string" || id === "") return [];
    return [{ id, at: typeof at === "string" ? at : "", version: typeof version === "string" ? version : "" }];
  });
}
