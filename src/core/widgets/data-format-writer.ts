/**
 * Writes the `DATA_FORMAT.md` of each data folder (#692). Only the hub runs it, as for the other
 * parts that Eva owns in the vault. The record keeps the hash of each file that Eva wrote, in
 * `state/data-formats.json` on the hub. It is not `.eva/template.json`: the template alignment
 * deletes each recorded path that is not a template part.
 */
import { lstatSync, type Stats } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJsonTolerant, readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import { contentHash } from "../vault/template-alignment.ts";
import { dataFormatFileName, dataFormatFirstLine } from "./data-format-file.ts";
import { placeOf } from "./widget-data.ts";

export const dataFormatRecordVersion = 1;

export const dataFormatRecordSchema = z.object({
  version: z.literal(dataFormatRecordVersion),
  files: z.array(
    z.object({
      /** The folder from the vault root. */
      folder: z.string(),
      /** The hash of the text that Eva wrote. */
      hash: z.string(),
    }),
  ),
});

/** The text that Eva writes into one folder. */
export interface FormatFolder {
  readonly folder: string;
  readonly text: string;
}

export interface FormatWrite {
  /** The files that Eva wrote, by their path from the vault root. */
  readonly written: readonly string[];
  /** The written files that someone had edited since Eva wrote them. */
  readonly edited: readonly string[];
}

export class DataFormatRecord {
  private readonly path: string;
  private readonly hashes: Map<string, string>;

  constructor(path: string) {
    this.path = path;
    const read = readJsonTolerant(path);
    const parsed = read.ok ? dataFormatRecordSchema.safeParse(read.value) : null;
    this.hashes = new Map(parsed?.success === true ? parsed.data.files.map((file) => [file.folder, file.hash]) : []);
  }

  get(folder: string): string | undefined {
    return this.hashes.get(folder);
  }

  /** Keeps exactly these hashes. */
  replace(hashes: ReadonlyMap<string, string>): void {
    const same =
      hashes.size === this.hashes.size && [...hashes].every(([folder, hash]) => this.hashes.get(folder) === hash);
    if (same) return;
    this.hashes.clear();
    for (const [folder, hash] of hashes) this.hashes.set(folder, hash);
    const files = [...this.hashes].map(([folder, hash]) => ({ folder, hash }));
    const file = { version: dataFormatRecordVersion, files };
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }
}

/**
 * Writes the file of each folder when its format changed since Eva last wrote it, or when it is
 * missing. An edit stays until the next change of the format: Eva then writes the whole file, and
 * reports the edit once. A folder with no widget left keeps its file, which still describes the data.
 */
export function writeDataFormats(
  vaultPath: string,
  folders: readonly FormatFolder[],
  record: DataFormatRecord,
): FormatWrite {
  const written: string[] = [];
  const edited: string[] = [];
  const hashes = new Map<string, string>();
  for (const { folder, text } of folders) {
    const path = `${folder}/${dataFormatFileName}`;
    // The folder must still be a place that a widget may reach, with no link on the way.
    if (placeOf(vaultPath, folder) !== "folder") continue;
    const target = join(vaultPath, ...path.split("/"));
    const stats = lstatOrNull(target);
    if (stats !== null && (!stats.isFile() || stats.nlink > 1)) continue;
    const hash = contentHash(text);
    const recorded = record.get(folder);
    hashes.set(folder, hash);
    const current = stats === null ? null : readTextTolerant(target);
    if (current !== null && recorded === hash) continue;
    if (current !== null && contentHash(current) === hash) continue;
    const wasEdited =
      current !== null &&
      (recorded === undefined ? !current.startsWith(dataFormatFirstLine) : contentHash(current) !== recorded);
    writeFileAtomic(target, text);
    written.push(path);
    if (wasEdited) edited.push(path);
  }
  record.replace(hashes);
  return { written, edited };
}

/** The one notice after Eva wrote over an edit. */
export function dataFormatEditedMessage(edited: readonly string[]): string {
  const files = edited.join(", ");
  return `The format of a widget folder changed, so Eva wrote ${files} again. Someone had edited it, and the vault history keeps that version. Write your notes in the AGENTS.md or the README.md of the folder.`;
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
