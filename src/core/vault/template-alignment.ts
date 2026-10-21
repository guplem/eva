/**
 * Keeps the vault's template parts, such as the skills in `.eva/skills/`, aligned with this Eva's
 * template. A vault gets its template once, so without this step a person who installed Eva
 * earlier never gets a new skill. The record `.eva/template.json` keeps the hash of each part as
 * Eva wrote it: a file with another hash is one that the person changed, so Eva never overwrites it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { AlertProblem } from "../alerts/alert-center.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";

/**
 * - `current`: the vault has this Eva's version.
 * - `yours`: the person changed the part, and Eva's version did not change since.
 * - `kept`: the person chose to keep their version of this Eva's version.
 * - `differs`: Eva has a new version, and the person changed theirs. The person chooses.
 * - `missing`: the person deleted the part. Eva does not put it back by herself.
 */
export type PartState = "current" | "yours" | "kept" | "differs" | "missing";

export interface TemplatePart {
  /** The path from the vault root, such as `.eva/skills/schedule/SKILL.md`. */
  readonly path: string;
  /** What a person calls the part: the skill's folder name. */
  readonly name: string;
  readonly state: PartState;
  /** When Eva last wrote this Eva's version, or null when she never did. */
  readonly updatedAt: string | null;
  /** This Eva's version, so the person can merge it into theirs. Only a part that differs has it. */
  readonly newText: string | null;
}

export const templateRecordFormatVersion = 1;

const recordedPartSchema = z.object({
  /** The hash of the text that Eva wrote. */
  installed: z.string(),
  /** The hash of Eva's version that the person chose not to take, or null. */
  kept: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const recordSchema = z.object({
  version: z.literal(templateRecordFormatVersion),
  parts: z.record(z.string(), recordedPartSchema),
});

export type RecordedPart = z.infer<typeof recordedPartSchema>;
type TemplateRecord = z.infer<typeof recordSchema>;

export interface TemplateAlignmentOptions {
  readonly vaultPath: string;
  /** The text of each template part, by path from the vault root. */
  readonly parts: Readonly<Record<string, string>>;
  /** The hashes of the older template versions of each part, for a vault from before the record. */
  readonly history: Readonly<Record<string, readonly string[]>>;
  readonly now: () => Date;
}

export function templateRecordPath(vaultPath: string): string {
  return join(vaultPath, ".eva", "template.json");
}

/** The hash of a text. Line ends do not count, because git turns them into CRLF on Windows. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
}

/**
 * The older versions of each template part, as hashes. A vault from before `.eva/template.json`
 * has no record, so this list tells Eva that its copy is an untouched old version. Later versions
 * need no entry here: the record keeps the hash of each version that Eva writes.
 */
export const templateHistory: Readonly<Record<string, readonly string[]>> = {
  ".eva/skills/schedule/SKILL.md": [
    "4195ce5c1ee02b29acf0407f80423ece5a9568f67725803f99c37af6b4ac0328",
    "7e1ca739578c02f76375a2934636cdfe19bec5b4f9d58e4dab8485691bdcdc6c",
    "0bdbe3e81ae2551ea996c5e692e60a1ae76bb7a9a32548723d136972d196a117",
    "0b5af6b0331b75b41c6612957c75f158988e37d58cdc6b1655a7f09036e4b366",
  ],
};

export class TemplateAlignment {
  private readonly options: TemplateAlignmentOptions;

  constructor(options: TemplateAlignmentOptions) {
    this.options = options;
  }

  /** The state of each part, with no change to the vault. */
  list(): TemplatePart[] {
    const record = this.readRecord();
    return this.paths().map((path) => this.partOf(path, this.stateOf(path, record.parts[path]), record.parts[path]));
  }

  /**
   * Installs the new parts, updates the parts that the person never changed, and removes the
   * retired parts that the person never changed. Returns the state of each part after that.
   */
  align(): TemplatePart[] {
    assertVaultWritable(this.options.vaultPath);
    const record = this.readRecord();
    const parts: Record<string, RecordedPart> = {};
    for (const [path, entry] of Object.entries(record.parts)) {
      if (path in this.options.parts) parts[path] = entry;
      else this.retire(path, entry);
    }
    const result = this.paths().map((path) => {
      const entry = parts[path];
      const state = this.stateOf(path, entry);
      if (state === "update" || state === "install") {
        parts[path] = this.write(path);
        return this.partOf(path, "current", parts[path]);
      }
      if (state === "current" && entry?.installed !== this.templateHash(path)) {
        parts[path] = { installed: this.templateHash(path), kept: null, updatedAt: entry?.updatedAt ?? null };
      }
      return this.partOf(path, state, parts[path]);
    });
    this.writeRecord({ version: templateRecordFormatVersion, parts });
    return result;
  }

  /** Writes this Eva's version of a part, over the person's version or in place of a deleted part. */
  useNew(path: string): TemplatePart[] {
    this.checkPath(path);
    const record = this.readRecord();
    this.writeRecord({ ...record, parts: { ...record.parts, [path]: this.write(path) } });
    return this.list();
  }

  /** Keeps the person's version, and asks again only when Eva has another new version. */
  keepMine(path: string): TemplatePart[] {
    this.checkPath(path);
    const record = this.readRecord();
    const entry = record.parts[path] ?? { installed: "", kept: null, updatedAt: null };
    this.writeRecord({ ...record, parts: { ...record.parts, [path]: { ...entry, kept: this.templateHash(path) } } });
    return this.list();
  }

  private paths(): string[] {
    return Object.keys(this.options.parts).sort();
  }

  private checkPath(path: string): void {
    assertVaultWritable(this.options.vaultPath);
    if (!(path in this.options.parts)) throw new EvaError("file_not_found", `${path} is not a part of Eva's template.`);
  }

  /** The state of a part, or the step that `align` takes by itself. */
  private stateOf(path: string, entry: RecordedPart | undefined): PartState | "install" | "update" {
    const file = this.fileHash(path);
    const template = this.templateHash(path);
    if (file === null) return entry === undefined ? "install" : "missing";
    if (file === template) return "current";
    if (entry === undefined) {
      return (this.options.history[path] ?? []).includes(file) ? "update" : "differs";
    }
    if (file === entry.installed) return "update";
    if (entry.installed === template) return "yours";
    return entry.kept === template ? "kept" : "differs";
  }

  private partOf(path: string, state: PartState | "install" | "update", entry: RecordedPart | undefined): TemplatePart {
    // `list` shows a step that `align` would take by itself as the state after that step.
    const shown: PartState = state === "update" ? "differs" : state === "install" ? "missing" : state;
    const newText = shown === "differs" ? (this.options.parts[path] ?? null) : null;
    return { path, name: basename(dirname(path)), state: shown, updatedAt: entry?.updatedAt ?? null, newText };
  }

  private write(path: string): RecordedPart {
    const target = join(this.options.vaultPath, path);
    mkdirSync(dirname(target), { recursive: true });
    const text = this.options.parts[path] ?? "";
    writeFileAtomic(target, text);
    return { installed: contentHash(text), kept: null, updatedAt: this.options.now().toISOString() };
  }

  /** A part that this Eva's template no longer has: gone when untouched, the person's own when changed. */
  private retire(path: string, entry: RecordedPart): void {
    if (this.fileHash(path) !== entry.installed) return;
    const target = join(this.options.vaultPath, path);
    rmSync(target, { force: true });
    const folder = dirname(target);
    if (existsSync(folder) && readdirSync(folder).length === 0) rmdirSync(folder);
  }

  private fileHash(path: string): string | null {
    const target = join(this.options.vaultPath, path);
    return existsSync(target) ? contentHash(readFileSync(target, "utf-8")) : null;
  }

  private templateHash(path: string): string {
    return contentHash(this.options.parts[path] ?? "");
  }

  /** A missing or damaged record reads as empty: the next `align` writes a good one. */
  private readRecord(): TemplateRecord {
    const read = readJsonTolerant(templateRecordPath(this.options.vaultPath));
    const parsed = read.ok ? recordSchema.safeParse(read.value) : null;
    return parsed?.success === true ? parsed.data : { version: templateRecordFormatVersion, parts: {} };
  }

  private writeRecord(record: TemplateRecord): void {
    writeFileAtomic(templateRecordPath(this.options.vaultPath), JSON.stringify(record, null, 2) + "\n");
  }
}

/** The alert of the parts that wait for the person's choice, or null when none waits. */
export function alignmentProblem(parts: readonly TemplatePart[]): AlertProblem | null {
  const waiting = parts.filter((part) => part.state === "differs").map((part) => part.name);
  if (waiting.length === 0) return null;
  const names = waiting.join(", ");
  return {
    level: "warn",
    message: `Eva has a new version of ${names}, and you changed your copy. Open Settings, Vault and sync, Template alignment, and choose which version to keep.`,
    resolvedMessage: "Your vault's template parts are aligned again.",
  };
}
