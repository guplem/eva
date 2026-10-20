/**
 * Fails when a branch removes a stored or typed name without a migration or a breaking commit (#98).
 * The release workflow raises the major version only for a breaking commit. A forgotten `!` ships
 * a break as a minor release. The update policy then installs it by itself.
 *
 * Each name is one line of `stored-names.txt`: `<kind> <where> <name>`. The kinds are `machine`
 * and `vault` (files of that store), `typed` (what a person types) and `migration`.
 * Event kinds and error codes are not here. The web page ships in the same release as the core.
 * Run with `--write` to update the file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { HubClaim } from "../src/core/instance/hub.ts";
import { migrations } from "../src/core/migrations/migrations.ts";
import type { StoredDevice } from "../src/core/remote-access/device-logins.ts";
import {
  dayNames,
  formatVersion as scheduleFormatVersion,
  scheduleFieldOrder,
} from "../src/core/schedules/schedule-definitions.ts";
import { sessionSchema, storeSchema } from "../src/core/sessions/session-store.ts";
import { configSchema, secretsSchema } from "../src/core/settings/home.ts";
import { isSharedSettingKey } from "../src/core/settings/settings.ts";
import { commitChange } from "../src/core/updates/release-version.ts";
import { cliCommands, switches, valueOptions } from "../src/frontends/cli/arguments.ts";
import { commands as telegramCommands } from "../src/frontends/telegram/telegram-bot.ts";

const snapshotPath = join(import.meta.dir, "stored-names.txt");
const snapshotFile = "scripts/stored-names.txt";

/** The part of a zod schema's definition that the walk reads. */
interface SchemaNode {
  readonly _zod: {
    readonly def: {
      readonly type: string;
      readonly shape?: Readonly<Record<string, SchemaNode>>;
      readonly innerType?: SchemaNode;
      readonly element?: SchemaNode;
      readonly entries?: Readonly<Record<string, string | number>>;
      readonly values?: readonly unknown[];
      readonly options?: readonly SchemaNode[];
      readonly in?: SchemaNode;
      readonly out?: SchemaNode;
    };
  };
}

/** Each key path of a schema, such as `sync.enabled`. Each enum or literal value adds a name, such as `updates.install=minor`. */
export function schemaNames(schema: z.ZodType): string[] {
  return walkSchema(schema, "");
}

function walkSchema(node: SchemaNode, path: string): string[] {
  const def = node._zod.def;
  switch (def.type) {
    case "object":
      return Object.entries(def.shape ?? {}).flatMap(([key, inner]) => {
        const keyPath = path === "" ? key : `${path}.${key}`;
        return [keyPath, ...walkSchema(inner, keyPath)];
      });
    case "array":
      return def.element === undefined ? [] : walkSchema(def.element, `${path}[]`);
    case "enum":
      return Object.values(def.entries ?? {}).map((value) => `${path}=${String(value)}`);
    case "literal":
      return (def.values ?? []).map((value) => `${path}=${String(value)}`);
    case "union":
      return (def.options ?? []).flatMap((option) => walkSchema(option, path));
    case "pipe":
      // A preprocess step is a pipe from a transform, so the real schema can sit on either side.
      return [def.in, def.out].flatMap((side) => (side === undefined ? [] : walkSchema(side, path)));
    default:
      // A default, nullable, optional or catch wraps the real type.
      if (def.innerType !== undefined) return walkSchema(def.innerType, path);
      if (leafTypes.has(def.type)) return [];
      // The walk cannot list the names in a record, tuple or lazy type. It throws, so that no name slips past.
      throw new Error(`The stored-name check cannot read the names in a zod ${def.type} at ${path || "(root)"}.`);
  }
}

/** The zod types that hold no names inside. */
const leafTypes = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "date",
  "null",
  "undefined",
  "unknown",
  "any",
  "transform",
  "custom",
  "never",
  "void",
  "nan",
  "symbol",
  "file",
  "template_literal",
]);

// These files have no zod schema. `satisfies` makes the typecheck fail until a new field is listed.
const hubFields = Object.keys({ machine: true, since: true } satisfies Record<keyof HubClaim, true>);
const deviceFields = Object.keys({ hash: true, label: true, createdAt: true } satisfies Record<
  keyof StoredDevice,
  true
>);

/** The key of a name, without its value and its array marks, as the settings name it. */
function settingKeyOf(name: string): string {
  return name.split("=")[0]?.replaceAll("[]", "") ?? name;
}

/** Every stored and typed name of this checkout, sorted. */
export function currentNames(): string[] {
  const config = schemaNames(configSchema);
  const lines = [
    ...config.map((name) => `machine config.json ${name}`),
    ...schemaNames(secretsSchema).map((name) => `machine secrets.json ${name}`),
    ...[...schemaNames(storeSchema), ...schemaNames(sessionSchema).map((name) => `sessions[].${name}`)].map(
      (name) => `machine state/sessions.json ${name}`,
    ),
    ...["devices", ...deviceFields.map((field) => `devices[].${field}`)].map(
      (name) => `machine state/devices.json ${name}`,
    ),
    ...config
      .filter((name) => isSharedSettingKey(settingKeyOf(name)))
      .map((name) => `vault .eva/settings.json ${name}`),
    ...[
      "version",
      `version=${String(scheduleFormatVersion)}`,
      "schedules",
      ...scheduleFieldOrder.map((field) => `schedules[].${field}`),
      ...dayNames.map((day) => `schedules[].days=${day}`),
    ].map((name) => `vault .eva/schedules.json ${name}`),
    ...hubFields.map((field) => `vault .eva/hub.json ${field}`),
    ...[...cliCommands, ...switches, ...valueOptions].map((name) => `typed cli ${name}`),
    ...telegramCommands.map((entry) => `typed telegram /${entry.command}`),
    ...migrations.map((migration) => `migration ${migration.store} ${migration.id}`),
  ];
  return [...new Set(lines)].sort();
}

export function renderSnapshot(names: readonly string[]): string {
  return [
    "# The stored and typed names of Eva. scripts/check-stored-names.ts compares them with origin/main.",
    "# Update this file with: bun run scripts/check-stored-names.ts --write",
    ...names,
    "",
  ].join("\n");
}

export function parseSnapshot(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .sort();
}

/** True when a commit of `git log --format=%s%x00%b%x01` output marks a breaking change. */
export function hasBreakingCommit(log: string): boolean {
  return log.split("\u0001").some((record) => {
    const [subject = "", body = ""] = record.split("\u0000");
    const trimmed = subject.trim();
    return trimmed.length > 0 && commitChange({ subject: trimmed, body }) === "breaking";
  });
}

export interface NamesVerdict {
  readonly ok: boolean;
  readonly message: string;
}

export interface NamesChange {
  readonly before: readonly string[];
  readonly after: readonly string[];
  /** True when a commit of the branch is marked breaking. */
  readonly breaking: boolean;
}

/**
 * A removed stored name passes with a new migration of its store, or with a breaking commit.
 * A removed typed name or migration passes only with a breaking commit. No migration repairs a
 * person's script. A removed migration id makes an older record look newer, and that stops the vault writes.
 */
export function judgeNames(change: NamesChange): NamesVerdict {
  const kept = new Set(change.after);
  const removed = change.before.filter((name) => !kept.has(name));
  if (removed.length === 0) return { ok: true, message: "No stored or typed name goes away.\n" };
  const had = new Set(change.before);
  const migratedStores = new Set(
    change.after.filter((name) => name.startsWith("migration ") && !had.has(name)).map((name) => name.split(" ")[1]),
  );
  const uncovered = removed.filter((name) => {
    const kind = name.split(" ")[0];
    return !((kind === "machine" || kind === "vault") && migratedStores.has(kind));
  });
  const list = (names: readonly string[]): string => names.map((name) => `  ${name}\n`).join("");
  if (change.breaking) return { ok: true, message: `A breaking commit covers these removed names:\n${list(removed)}` };
  if (uncovered.length === 0)
    return { ok: true, message: `A new migration covers these removed names:\n${list(removed)}` };
  return {
    ok: false,
    message:
      "These names go away, so a person's data, commands or scripts can break after the update:\n" +
      list(uncovered) +
      "Do one of these:\n" +
      "  - Mark a commit as breaking with `!`, such as `feat!: ...`, or with a `BREAKING CHANGE:` footer. This covers every name.\n" +
      "  - For a `machine` or `vault` name only: add a migration of that store in src/core/migrations/.\n",
  };
}

function git(args: readonly string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString() };
}

function readSnapshotFile(): string[] | null {
  try {
    return parseSnapshot(readFileSync(snapshotPath, "utf8"));
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const names = currentNames();
  if (process.argv.includes("--write")) {
    writeFileSync(snapshotPath, renderSnapshot(names));
    process.stdout.write(`Wrote ${snapshotFile}.\n`);
    process.exit(0);
  }
  if (readSnapshotFile()?.join("\n") !== names.join("\n")) {
    process.stderr.write(
      `${snapshotFile} does not match the code. Run \`bun run scripts/check-stored-names.ts --write\`, then commit the file.\n`,
    );
    process.exit(1);
  }
  const base = git(["merge-base", "origin/main", "HEAD"]);
  const before = base.ok ? git(["show", `${base.stdout.trim()}:${snapshotFile}`]) : null;
  if (before?.ok !== true) {
    process.stdout.write(`No ${snapshotFile} on origin/main to compare with. The stored-name check is skipped.\n`);
    process.exit(0);
  }
  const log = git(["log", "--no-merges", "--format=%s%x00%b%x01", `${base.stdout.trim()}..HEAD`]).stdout;
  const verdict = judgeNames({ before: parseSnapshot(before.stdout), after: names, breaking: hasBreakingCommit(log) });
  (verdict.ok ? process.stdout : process.stderr).write(verdict.message);
  process.exit(verdict.ok ? 0 : 1);
}
