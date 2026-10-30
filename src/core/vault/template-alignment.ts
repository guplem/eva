/**
 * Keeps the vault's template parts, such as the skills in `.eva/skills/`, aligned with this Eva's
 * template. A vault gets its template once, so without this step a person who installed Eva
 * earlier never gets a new skill. The record `.eva/template.json` keeps the hash of each part as
 * Eva wrote it: a file with another hash is one that the person changed, so Eva never overwrites it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { AlertProblem } from "../alerts/alert-center.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { isNewerVersion } from "../updates/version-order.ts";

/**
 * - `current`: the vault has this Eva's version.
 * - `pending`: the hub installs or updates the part at its next start. The person changed nothing.
 * - `yours`: the person changed the part, and Eva's version did not change since.
 * - `kept`: the person chose to keep their version of this Eva's version.
 * - `differs`: Eva has a new version, and the person changed theirs. The person chooses.
 * - `missing`: the person deleted the part. Eva does not put it back by herself.
 */
export type PartState = "current" | "pending" | "yours" | "kept" | "differs" | "missing";

/** What a part is. Each kind gives the word that the page and the alert use for it. */
export type PartKind = "skill" | "text action" | "saved prompt";

export interface TemplatePart {
  /** The path from the vault root, such as `.eva/skills/schedule/SKILL.md`. */
  readonly path: string;
  readonly kind: PartKind;
  /** What a person calls the part, such as the skill's name. */
  readonly name: string;
  readonly state: PartState;
  /** When Eva last wrote this Eva's version, or null when she never did. */
  readonly updatedAt: string | null;
  /** This Eva's version, so the person can merge it into theirs. Only a part that differs has it. */
  readonly newText: string | null;
}

/**
 * The kinds of part, by the folder where they live. A new kind is one more entry. The name of a
 * part is the first folder or file under that place, so a skill with extra files keeps one name.
 */
const partKinds: readonly { readonly kind: PartKind; readonly folder: string }[] = [
  { kind: "skill", folder: ".eva/skills/" },
  { kind: "text action", folder: ".eva/settings/text-actions/" },
  { kind: "saved prompt", folder: ".eva/settings/saved-prompts/" },
];

function describePath(path: string): { readonly kind: PartKind; readonly name: string } {
  const place = partKinds.find((each) => path.startsWith(each.folder)) ?? partKinds[0];
  const folder = place?.folder ?? "";
  const name = path.slice(folder.length).split("/")[0] ?? path;
  // A menu item is one file, and the menu shows its name without the extension.
  return { kind: place?.kind ?? "skill", name: name.endsWith(".md") ? name.slice(0, -".md".length) : name };
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
  /** The Eva that last wrote the record. An older Eva never writes over a newer Eva's parts. */
  eva: z.string().optional(),
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
  /** This Eva's version, which the record keeps. */
  readonly evaVersion: string;
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
 * The older versions of each template part, as hashes: `git show <commit>:<template path> | sha256sum`
 * for each commit that changed the file. A vault from before `.eva/template.json` has no record, so
 * this list tells Eva that its copy is an untouched old version. Later versions need no entry here:
 * the record keeps the hash of each version that Eva writes.
 */
export const templateHistory: Readonly<Record<string, readonly string[]>> = {
  ".eva/skills/schedule/SKILL.md": [
    "4195ce5c1ee02b29acf0407f80423ece5a9568f67725803f99c37af6b4ac0328",
    "7e1ca739578c02f76375a2934636cdfe19bec5b4f9d58e4dab8485691bdcdc6c",
    "0bdbe3e81ae2551ea996c5e692e60a1ae76bb7a9a32548723d136972d196a117",
    "0b5af6b0331b75b41c6612957c75f158988e37d58cdc6b1655a7f09036e4b366",
  ],
};

type Step = PartState | "install" | "update";

export class TemplateAlignment {
  private readonly options: TemplateAlignmentOptions;

  constructor(options: TemplateAlignmentOptions) {
    this.options = options;
  }

  /** The state of each part, with no change to the vault. */
  list(): TemplatePart[] {
    const record = this.readRecord();
    return this.paths().map((path) => this.partOf(path, this.stepOf(path, record.parts[path]), record.parts[path]));
  }

  /**
   * Installs the new parts, updates the parts that the person never changed, and removes the
   * retired parts that the person never changed. Returns the state of each part after that.
   */
  align(): TemplatePart[] {
    const record = this.writableRecord();
    const parts: Record<string, RecordedPart> = {};
    for (const [path, entry] of Object.entries(record.parts)) {
      if (path in this.options.parts) parts[path] = entry;
      else this.retire(path, entry);
    }
    const result = this.paths().map((path) => {
      const entry = parts[path];
      const step = this.stepOf(path, entry);
      if (step === "update" || step === "install") {
        parts[path] = this.write(path);
        return this.partOf(path, "current", parts[path]);
      }
      if (step === "current" && entry?.installed !== this.templateHash(path)) {
        parts[path] = { installed: this.templateHash(path), kept: null, updatedAt: entry?.updatedAt ?? null };
      }
      return this.partOf(path, step, parts[path]);
    });
    this.writeRecord(parts);
    return result;
  }

  /** Writes this Eva's version of a part, over the person's version or in place of a deleted part. */
  useNew(path: string): TemplatePart[] {
    this.checkPath(path);
    const record = this.writableRecord();
    this.writeRecord({ ...record.parts, [path]: this.write(path) });
    return this.list();
  }

  /** Keeps the person's version, and asks again only when Eva has another new version. */
  keepMine(path: string): TemplatePart[] {
    this.checkPath(path);
    const record = this.writableRecord();
    const entry = record.parts[path] ?? { installed: "", kept: null, updatedAt: null };
    this.writeRecord({ ...record.parts, [path]: { ...entry, kept: this.templateHash(path) } });
    return this.list();
  }

  private paths(): string[] {
    return Object.keys(this.options.parts).sort();
  }

  private checkPath(path: string): void {
    if (!(path in this.options.parts)) throw new EvaError("file_not_found", `${path} is not a part of Eva's template.`);
  }

  /** The state of a part, or the step that `align` takes by itself. */
  private stepOf(path: string, entry: RecordedPart | undefined): Step {
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

  private partOf(path: string, step: Step, entry: RecordedPart | undefined): TemplatePart {
    // `list` shows a step that `align` takes by itself as pending: the person has nothing to do.
    const state: PartState = step === "update" || step === "install" ? "pending" : step;
    const newText = state === "differs" ? (this.options.parts[path] ?? null) : null;
    return { path, ...describePath(path), state, updatedAt: entry?.updatedAt ?? null, newText };
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

  /**
   * The record, when this Eva may write the parts. A newer Eva knows parts and versions that this
   * one does not: an older Eva would put old versions back and delete the new parts.
   */
  private writableRecord(): TemplateRecord {
    assertVaultWritable(this.options.vaultPath);
    const read = readJsonTolerant(templateRecordPath(this.options.vaultPath));
    const value = read.ok ? (read.value as { version?: unknown; eva?: unknown }) : null;
    const newerFormat = typeof value?.version === "number" && value.version > templateRecordFormatVersion;
    const newerEva = typeof value?.eva === "string" && isNewerVersion(value.eva, this.options.evaVersion);
    if (newerFormat || newerEva) {
      throw new EvaError("vault_ahead", "A newer Eva wrote the vault's template parts. Update Eva on this computer.");
    }
    return this.readRecord();
  }

  private writeRecord(parts: Record<string, RecordedPart>): void {
    const record: TemplateRecord = { version: templateRecordFormatVersion, eva: this.options.evaVersion, parts };
    writeFileAtomic(templateRecordPath(this.options.vaultPath), JSON.stringify(record, null, 2) + "\n");
  }
}

const kindWords: Readonly<Record<PartKind, string>> = {
  skill: "skill",
  "text action": "text action",
  "saved prompt": "saved prompt",
};

/** The alert of the parts that wait for the person's choice, or null when none waits. */
export function alignmentProblem(parts: readonly TemplatePart[]): AlertProblem | null {
  const waiting = parts
    .filter((part) => part.state === "differs")
    .map((part) => `${kindWords[part.kind]} ${part.name}`);
  if (waiting.length === 0) return null;
  return {
    level: "warn",
    message: `Eva has a new version of the ${waiting.join(", ")}, and you changed your copy. Open Settings, Vault and sync, Template alignment, and choose which version to keep.`,
    resolvedMessage: "Your vault's template parts are aligned again.",
  };
}
