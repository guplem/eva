import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";
import {
  migrationBackupPath,
  migrationsAhead,
  runMigrations,
  vaultMigrationRecordPath,
  type Migration,
  type MigrationRun,
} from "../../../../src/core/migrations/migration-runner.ts";

let root: string;
let paths: HomePaths;
let vault: string;
const now = (): Date => new Date("2026-10-20T08:00:00.000Z");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-migrations-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(migrations: readonly Migration[], store: "machine" | "vault" = "machine"): MigrationRun {
  return runMigrations({ store, migrations, paths, vaultPath: vault, version: "0.4.0", now });
}

function appliedIds(path: string): string[] {
  const record = JSON.parse(readFileSync(path, "utf-8")) as { applied: { id: string }[] };
  return record.applied.map((entry) => entry.id);
}

/** A migration that appends its id to a machine file, so the order shows. */
function appending(id: string, store: "machine" | "vault" = "machine"): Migration {
  return {
    id,
    store,
    run: (context) => {
      const file = store === "machine" ? join(paths.root, "order.txt") : join(vault, ".eva", "order.txt");
      const before = existsSync(file) ? readFileSync(file, "utf-8") : "";
      context.write(file, `${before}${id}\n`);
      return "done";
    },
  };
}

describe("runMigrations", () => {
  test("a fresh install runs every migration in id order and records each id", () => {
    const result = run([appending("2026-10-21-b"), appending("2026-10-20-a")]);
    expect(result).toEqual({ kind: "done", applied: ["2026-10-20-a", "2026-10-21-b"], later: [] });
    expect(readFileSync(join(paths.root, "order.txt"), "utf-8")).toBe("2026-10-20-a\n2026-10-21-b\n");
    expect(appliedIds(paths.migrationRecord)).toEqual(["2026-10-20-a", "2026-10-21-b"]);
  });

  test("the record keeps when and with which version each migration ran", () => {
    run([appending("2026-10-20-a")]);
    const record = JSON.parse(readFileSync(paths.migrationRecord, "utf-8")) as unknown;
    expect(record).toEqual({ applied: [{ id: "2026-10-20-a", at: "2026-10-20T08:00:00.000Z", version: "0.4.0" }] });
  });

  test("a second start runs only the missing migrations", () => {
    run([appending("2026-10-20-a")]);
    const result = run([appending("2026-10-20-a"), appending("2026-10-22-c")]);
    expect(result).toEqual({ kind: "done", applied: ["2026-10-22-c"], later: [] });
    expect(readFileSync(join(paths.root, "order.txt"), "utf-8")).toBe("2026-10-20-a\n2026-10-22-c\n");
  });

  test("a migration that merged later with an older id still runs", () => {
    run([appending("2026-10-22-c")]);
    expect(run([appending("2026-10-20-a"), appending("2026-10-22-c")])).toEqual({
      kind: "done",
      applied: ["2026-10-20-a"],
      later: [],
    });
  });

  test("each store runs only its own migrations, into its own record", () => {
    const migrations = [appending("2026-10-20-machine"), appending("2026-10-20-vault", "vault")];
    expect(run(migrations, "vault")).toEqual({ kind: "done", applied: ["2026-10-20-vault"], later: [] });
    expect(appliedIds(vaultMigrationRecordPath(vault))).toEqual(["2026-10-20-vault"]);
    expect(existsSync(paths.migrationRecord)).toBe(false);
  });

  test("without a vault, the vault store runs nothing", () => {
    const result = runMigrations({
      store: "vault",
      migrations: [appending("2026-10-20-vault", "vault")],
      paths,
      vaultPath: null,
      version: "0.4.0",
      now,
    });
    expect(result).toEqual({ kind: "done", applied: [], later: [] });
  });

  test("a write keeps a .bak copy of the file before the first change", () => {
    const file = join(paths.root, "config.json");
    writeFileSync(file, "old\n");
    const migration: Migration = {
      id: "2026-10-20-a",
      store: "machine",
      run: (context) => {
        context.write(file, "new 1\n");
        context.write(file, "new 2\n");
        return "done";
      },
    };
    run([migration]);
    expect(readFileSync(file, "utf-8")).toBe("new 2\n");
    expect(readFileSync(migrationBackupPath(paths, migration, "config.json"), "utf-8")).toBe("old\n");
  });

  test("the copy of a vault file stays in the machine's home, out of the vault", () => {
    const file = join(vault, ".eva", "settings.json");
    writeFileSync(file, '{"trust":{}}\n');
    const migration: Migration = {
      id: "2026-10-20-a",
      store: "vault",
      run: (context) => {
        context.write(file, "{}\n");
        return "done";
      },
    };
    run([migration], "vault");
    const backup = migrationBackupPath(paths, migration, join(".eva", "settings.json"));
    expect(backup.startsWith(paths.root)).toBe(true);
    expect(readFileSync(backup, "utf-8")).toBe('{"trust":{}}\n');
  });

  test("a migration that must wait is not recorded, and the later ones still run", () => {
    const waiting: Migration = { id: "2026-10-20-a", store: "machine", run: () => "later" };
    expect(run([waiting, appending("2026-10-21-b")])).toEqual({
      kind: "done",
      applied: ["2026-10-21-b"],
      later: ["2026-10-20-a"],
    });
    expect(appliedIds(paths.migrationRecord)).toEqual(["2026-10-21-b"]);
  });

  test("a machine migration cannot write a vault file", () => {
    const migration: Migration = {
      id: "2026-10-20-a",
      store: "machine",
      run: (context) => {
        context.write(join(vault, ".eva", "settings.json"), "{}\n");
        return "done";
      },
    };
    const result = run([migration]);
    expect(result).toMatchObject({ kind: "failed", id: "2026-10-20-a" });
    expect(existsSync(join(vault, ".eva", "settings.json"))).toBe(false);
  });

  test("a failed migration keeps the files as they were, is not recorded, and stops the run", () => {
    const file = join(paths.root, "config.json");
    const created = join(paths.root, "created.json");
    writeFileSync(file, "old\n");
    const failing: Migration = {
      id: "2026-10-21-b",
      store: "machine",
      run: (context) => {
        context.write(file, "half\n");
        context.write(created, "half\n");
        throw new Error("disk is full");
      },
    };
    const result = run([appending("2026-10-20-a"), failing, appending("2026-10-22-c")]);
    expect(result).toEqual({ kind: "failed", applied: ["2026-10-20-a"], id: "2026-10-21-b", reason: "disk is full" });
    expect(readFileSync(file, "utf-8")).toBe("old\n");
    expect(existsSync(created)).toBe(false);
    expect(appliedIds(paths.migrationRecord)).toEqual(["2026-10-20-a"]);
    expect(readFileSync(join(paths.root, "order.txt"), "utf-8")).toBe("2026-10-20-a\n");
  });

  test("the next start tries a failed migration again", () => {
    let fail = true;
    const flaky: Migration = {
      id: "2026-10-20-a",
      store: "machine",
      run: () => {
        if (fail) throw new Error("not yet");
        return "done";
      },
    };
    run([flaky]);
    fail = false;
    expect(run([flaky])).toEqual({ kind: "done", applied: ["2026-10-20-a"], later: [] });
  });

  test("a run that stopped halfway runs the unrecorded migration again, and keeps the first copy", () => {
    const file = join(paths.root, "config.json");
    const migration: Migration = {
      id: "2026-10-20-a",
      store: "machine",
      run: (context) => {
        const current = readFileSync(file, "utf-8");
        if (!current.includes("+")) context.write(file, current.replace("\n", "+\n"));
        return "done";
      },
    };
    const backup = migrationBackupPath(paths, migration, "config.json");
    // The first run wrote the file and its copy, then the process died before the record.
    mkdirSync(join(paths.stateFolder, "migration-backups", "2026-10-20-a", "machine"), { recursive: true });
    writeFileSync(backup, "old\n");
    writeFileSync(file, "old+\n");
    expect(run([migration])).toEqual({ kind: "done", applied: ["2026-10-20-a"], later: [] });
    expect(readFileSync(file, "utf-8")).toBe("old+\n");
    expect(readFileSync(backup, "utf-8")).toBe("old\n");
  });

  test("a record with an unknown id runs nothing: a newer Eva wrote it", () => {
    run([appending("2026-10-20-a"), appending("2026-11-01-newer")]);
    const result = run([appending("2026-10-20-a"), appending("2026-10-25-missing")]);
    expect(result).toEqual({ kind: "ahead", unknown: ["2026-11-01-newer"] });
    expect(readFileSync(join(paths.root, "order.txt"), "utf-8")).toBe("2026-10-20-a\n2026-11-01-newer\n");
  });

  test("a broken record runs nothing and says so", () => {
    writeFileSync(paths.migrationRecord, "{ not json");
    const result = run([appending("2026-10-20-a")]);
    expect(result).toMatchObject({ kind: "failed", applied: [], id: null });
    expect(existsSync(join(paths.root, "order.txt"))).toBe(false);
  });
});

describe("migrationsAhead", () => {
  test("names the unknown ids and the version that recorded the newest one", () => {
    const record = join(vault, ".eva", "migrations.json");
    writeFileSync(
      record,
      JSON.stringify({
        applied: [
          { id: "2026-10-20-a", at: "", version: "0.4.0" },
          { id: "2026-11-01-b", at: "", version: "0.5.0" },
          { id: "2026-11-09-c", at: "", version: "0.6.1" },
        ],
      }),
    );
    expect(migrationsAhead(record, ["2026-10-20-a"])).toEqual({
      unknown: ["2026-11-01-b", "2026-11-09-c"],
      version: "0.6.1",
      readable: true,
    });
  });

  test("is null when every recorded id is known, or the record is missing", () => {
    const record = join(vault, ".eva", "migrations.json");
    expect(migrationsAhead(record, [])).toBeNull();
    writeFileSync(record, JSON.stringify({ applied: [{ id: "2026-10-20-a", at: "", version: "0.4.0" }] }));
    expect(migrationsAhead(record, ["2026-10-20-a"])).toBeNull();
  });

  test("a record in a shape that this Eva cannot read counts as ahead: a newer Eva may have changed it", () => {
    const record = join(vault, ".eva", "migrations.json");
    for (const broken of ["{ broken", JSON.stringify({ applied: [{ name: "2099-01-01-renamed-field" }] })]) {
      writeFileSync(record, broken);
      expect(migrationsAhead(record, [])).toEqual({ unknown: [], version: null, readable: false });
    }
  });
});

describe("the record", () => {
  test("a rewrite keeps the fields that a newer Eva added to an entry", () => {
    writeFileSync(
      paths.migrationRecord,
      JSON.stringify({ applied: [{ id: "2026-10-20-a", at: "", version: "0.4.0", note: "from a newer Eva" }] }),
    );
    run([appending("2026-10-20-a"), appending("2026-10-21-b")]);
    const record = JSON.parse(readFileSync(paths.migrationRecord, "utf-8")) as { applied: unknown[] };
    expect(record.applied[0]).toEqual({ id: "2026-10-20-a", at: "", version: "0.4.0", note: "from a newer Eva" });
  });
});
