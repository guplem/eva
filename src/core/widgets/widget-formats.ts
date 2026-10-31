/**
 * The data formats of the approved widgets (#692): the `DATA_FORMAT.md` of each data folder, the
 * conflicts of a new widget with the folder's format, the widget lines of the Assistant prompt,
 * and the check of the files that an Assistant turn changed.
 *
 * Each part reads only the approved records of this computer that still fit `.eva/widgets.json`,
 * and each schema from the installed copy of the approved commit. A widget that is off keeps its
 * fields; a removed widget has no record, so its fields go.
 */
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { contentHash } from "../vault/template-alignment.ts";
import { dataFormatFileName, dataFormatText, type DataFormatUse } from "./data-format-file.ts";
import { writeDataFormats, type DataFormatRecord, type FormatWrite } from "./data-format-writer.ts";
import { mergeFormats, type FormatConflict } from "./data-formats.ts";
import { widgetAddress, type WidgetAddress } from "./widget-address.ts";
import { configOf, matches, type ApprovedPath, type WidgetApprovals } from "./widget-approvals.ts";
import { checkData } from "./widget-contract.ts";
import type { WidgetCopies } from "./widget-copies.ts";
import { parseData, readVaultData } from "./widget-data.ts";
import { readWidgetList } from "./widget-list.ts";
import { isWritableName, matchesFiles } from "./widget-places.ts";
import { defaultPrompt, filledPrompt, oneLine, type PromptPlace } from "./widget-prompt.ts";

/** One input with a schema, in the folder of its `DATA_FORMAT.md`. */
export interface FolderUse extends DataFormatUse {
  /** The folder from the vault root, or "" for a file at the vault root. */
  readonly folder: string;
  readonly input: string;
}

export interface WidgetFormatsOptions {
  readonly vaultPath: string;
  readonly approvals: WidgetApprovals;
  readonly copies: Pick<WidgetCopies, "serveFile">;
  readonly exclusive: <Result>(work: () => Result) => Promise<Result>;
  /** The hashes of the files that Eva wrote. Null: this computer writes none. */
  readonly record: DataFormatRecord | null;
  /** Only the hub writes the files, as for the other parts that Eva owns in the vault. */
  readonly isHub: () => boolean;
  /** Tells the person once that Eva wrote over an edit of these files. */
  readonly notify: (edited: readonly string[]) => void;
}

/** The files that a widget wrote, by path, so the check after a turn leaves them out. */
const maxWritten = 500;

export class WidgetFormats {
  private readonly options: WidgetFormatsOptions;
  private readonly written: Map<string, string>;

  constructor(options: WidgetFormatsOptions) {
    this.options = options;
    this.written = new Map();
  }

  /** Each input with a schema of each approved widget that fits the vault list, on or off. */
  uses(): FolderUse[] {
    return readWidgetList(this.options.vaultPath).flatMap((entry) => {
      const record = this.options.approvals.get(entry.id);
      const address = record === null ? null : widgetAddress(record.repository);
      if (record === null || address === null || !matches(record, entry)) return [];
      return record.paths.flatMap((approved): FolderUse[] => {
        const place = placeOfInput(approved);
        if (place === null || approved.schema === null) return [];
        const schema = installedSchema(this.options.copies, address, approved.schema);
        if (schema === null) return [];
        return [
          {
            widget: entry.id,
            name: oneLine(record.name),
            input: approved.input,
            access: approved.access,
            schema,
            ...place,
          },
        ];
      });
    });
  }

  /**
   * The conflicts that each of these inputs of a new approval would bring into its folder, by the
   * input id. `schemas` gives each schema by its path in the widget.
   */
  conflictsOf(
    id: string,
    name: string,
    paths: readonly ApprovedPath[],
    schemas: ReadonlyMap<string, unknown>,
  ): Map<string, FormatConflict[]> {
    // The new widget's own inputs count too: two of them can share a folder.
    const known: FolderUse[] = this.uses().filter((use) => use.widget !== id);
    const found = new Map<string, FormatConflict[]>();
    for (const approved of paths) {
      const place = placeOfInput(approved);
      const schema = approved.schema === null ? undefined : schemas.get(approved.schema);
      if (place === null || schema === undefined) continue;
      const use: FolderUse = { widget: id, name, input: approved.input, access: approved.access, schema, ...place };
      // A folder and its subfolder share the files of the subfolder.
      const before = known.filter((other) => overlaps(other, use));
      const base = mergeFormats(before).conflicts.length;
      // The conflicts of the places before come first; the rest are the new input's.
      const conflicts = mergeFormats([...before, use]).conflicts.slice(base);
      if (conflicts.length > 0) found.set(approved.input, conflicts);
      known.push(use);
    }
    return found;
  }

  /** Writes the `DATA_FORMAT.md` of each data folder. Only the hub writes; any other Eva gets null. */
  async sync(): Promise<FormatWrite | null> {
    const record = this.options.record;
    if (record === null || !this.options.isHub()) return null;
    const uses = this.uses();
    // The vault root holds the rules of the vault, not data.
    const folders = [...new Set(uses.map((use) => use.folder))]
      .filter((folder) => folder !== "")
      .map((folder) => ({
        folder,
        text: dataFormatText(
          folder,
          uses.filter((use) => readsFolder(use, folder)),
        ),
      }));
    const result = await this.options.exclusive(() => writeDataFormats(this.options.vaultPath, folders, record));
    if (result.edited.length > 0) this.options.notify(result.edited);
    return result;
  }

  /**
   * One line for the Assistant prompt for each widget that is on: the manifest's line with the
   * person's values, or a default line for a widget with data and no line of its own. The default
   * line names a `DATA_FORMAT.md` only when the folder has one.
   */
  promptLines(): string[] {
    return readWidgetList(this.options.vaultPath).flatMap((entry) => {
      const record = this.options.approvals.get(entry.id);
      if (!entry.enabled || record === null || !matches(record, entry)) return [];
      const places = record.paths.flatMap((approved): PromptPlace[] => {
        const place = placeOfInput(approved);
        if (place === null || approved.path === null) return [];
        const hasFormat =
          place.folder !== "" &&
          existsSync(join(this.options.vaultPath, ...place.folder.split("/"), dataFormatFileName));
        return [{ path: approved.path, formatFolder: hasFormat ? place.folder : null }];
      });
      const line =
        record.prompt === null
          ? defaultPrompt(record.name, places)
          : filledPrompt(record.prompt, configOf(record, entry));
      return line === null ? [] : [`- ${oneLine(record.name)}: ${line}`];
    });
  }

  /** Remembers a file that a widget wrote, so the check after a turn does not count it. */
  wrote(path: string): void {
    const text = readVaultData(this.options.vaultPath, path);
    this.written.delete(path);
    if (text === null) return;
    this.written.set(path, contentHash(text));
    for (const key of this.written.keys()) {
      if (this.written.size <= maxWritten) break;
      this.written.delete(key);
    }
  }

  /**
   * Checks the files that an Assistant turn changed against each schema whose pattern covers the
   * file, and gives one sentence for each file that does not fit. A file that no pattern covers is
   * not data of a widget. A file as a widget wrote it is the widget's: its own check ran at the write.
   */
  check(paths: readonly string[]): string[] {
    const uses = this.uses();
    const problems: string[] = [];
    for (const path of paths) {
      const name = posix.basename(path);
      const covering = uses.filter((use) => covers(use, path));
      if (covering.length === 0 || !isWritableName(name)) continue;
      const text = readVaultData(this.options.vaultPath, path);
      if (text === null || this.written.get(path) === contentHash(text)) continue;
      const yaml = /\.ya?ml$/i.test(name);
      const value = parseData(text, yaml);
      if (value === undefined) {
        problems.push(`${path} is not valid ${yaml ? "YAML" : "JSON"}.`);
        continue;
      }
      for (const use of covering) {
        const found = checkData(value, use.schema);
        if (found.length > 0) problems.push(`${path} does not fit the format of ${use.name}: ${found.join("; ")}.`);
      }
    }
    return problems;
  }
}

/** The schema of a written input, from the installed copy, or null. */
export function installedSchema(
  copies: Pick<WidgetCopies, "serveFile">,
  address: WidgetAddress,
  path: string,
): unknown {
  const answer = copies.serveFile(address, path);
  if (answer.status !== 200 || answer.body === undefined) return null;
  try {
    return JSON.parse(
      typeof answer.body === "string" ? answer.body : Buffer.from(answer.body).toString("utf-8"),
    ) as unknown;
  } catch {
    return null;
  }
}

/** Where the format of an input lives: the folder itself, or the folder of a file, for that one name. */
export function placeOfInput(approved: ApprovedPath): Pick<FolderUse, "folder" | "files" | "single"> | null {
  if (approved.path === null) return null;
  if (approved.type === "folder") return { folder: approved.path, files: approved.files, single: false };
  const folder = posix.dirname(approved.path);
  return { folder: folder === "." ? "" : folder, files: posix.basename(approved.path), single: true };
}

type Place = Pick<FolderUse, "folder" | "files" | "single">;

/** True for a file of `folder` with this name that the use reads. Without case, as Eva compares names. */
function coversFile(use: Place, folder: string, name: string): boolean {
  if (use.single) return same(use.folder, folder) && same(use.files ?? "", name);
  return within(folder, use.folder) && (use.files === null || matchesFiles(use.files, name));
}

function covers(use: Place, path: string): boolean {
  const folder = posix.dirname(path);
  return coversFile(use, folder === "." ? "" : folder, posix.basename(path));
}

/** True when two places can hold the same file: the same folder, a folder and its subfolder, or a file of a folder. */
function overlaps(first: Place, second: Place): boolean {
  if (first.single) return coversFile(second, first.folder, first.files ?? "");
  if (second.single) return coversFile(first, second.folder, second.files ?? "");
  return within(first.folder, second.folder) || within(second.folder, first.folder);
}

/** True when the use reads files in `folder`: its own folder, or a folder above it. */
function readsFolder(use: Place, folder: string): boolean {
  return same(use.folder, folder) || (!use.single && within(folder, use.folder));
}

function within(child: string, parent: string): boolean {
  return same(child, parent) || parent === "" || child.toLowerCase().startsWith(`${parent.toLowerCase()}/`);
}

function same(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}
