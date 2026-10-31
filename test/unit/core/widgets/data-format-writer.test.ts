import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataFormatFirstLine } from "../../../../src/core/widgets/data-format-file.ts";
import {
  DataFormatRecord,
  dataFormatEditedMessage,
  writeDataFormats,
} from "../../../../src/core/widgets/data-format-writer.ts";

let folder: string;
let vault: string;
let recordPath: string;
let record: DataFormatRecord;

const first = `${dataFormatFirstLine}\n\n# One\n`;
const second = `${dataFormatFirstLine}\n\n# Two\n`;

function onDisk(path = "Life/Habits/DATA_FORMAT.md"): string {
  return readFileSync(join(vault, path), "utf-8");
}

function edit(text: string, path = "Life/Habits/DATA_FORMAT.md"): void {
  writeFileSync(join(vault, path), text);
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-data-formats-"));
  vault = join(folder, "vault");
  mkdirSync(join(vault, "Life", "Habits"), { recursive: true });
  recordPath = join(folder, "state", "data-formats.json");
  record = new DataFormatRecord(recordPath);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("dataFormatEditedMessage", () => {
  test("names each file, and where the old version and the notes go", () => {
    expect(dataFormatEditedMessage(["Life/Habits/DATA_FORMAT.md"])).toBe(
      "The format of a widget folder changed, so Eva wrote Life/Habits/DATA_FORMAT.md again. Someone had edited it. The vault history keeps the version of the last sync. Write your notes in the AGENTS.md or the README.md of the folder.",
    );
  });
});

describe("writeDataFormats", () => {
  test("writes a new file, and nothing when the format stays", () => {
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record)).toEqual({
      written: ["Life/Habits/DATA_FORMAT.md"],
      edited: [],
    });
    expect(onDisk()).toBe(first);
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record).written).toEqual([]);
  });

  test("keeps an edit while the format stays, and replaces it with one notice when the format changes", () => {
    writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record);
    edit(`${first}My note.\n`);
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record).written).toEqual([]);
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: second }], record)).toEqual({
      written: ["Life/Habits/DATA_FORMAT.md"],
      edited: ["Life/Habits/DATA_FORMAT.md"],
    });
    expect(onDisk()).toBe(second);
  });

  test("rewrites an unedited file with no notice, and a deleted one", () => {
    writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record);
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: second }], record).edited).toEqual([]);
    rmSync(join(vault, "Life/Habits/DATA_FORMAT.md"));
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: second }], record)).toEqual({
      written: ["Life/Habits/DATA_FORMAT.md"],
      edited: [],
    });
  });

  test("with no record, takes a file without the generated line as edited", () => {
    edit("The person's own text.\n");
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record).edited).toEqual([
      "Life/Habits/DATA_FORMAT.md",
    ]);
    const other = new DataFormatRecord(join(folder, "other.json"));
    edit(second);
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], other)).toEqual({
      written: ["Life/Habits/DATA_FORMAT.md"],
      edited: [],
    });
  });

  test("keeps the file of a folder with no widget left, and forgets it", () => {
    writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record);
    writeDataFormats(vault, [], record);
    expect(onDisk()).toBe(first);
    expect(new DataFormatRecord(recordPath).get("Life/Habits")).toBeUndefined();
  });

  test("keeps the record across a restart", () => {
    writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record);
    edit(`${first}x\n`);
    const again = new DataFormatRecord(recordPath);
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: second }], again).edited).toEqual([
      "Life/Habits/DATA_FORMAT.md",
    ]);
  });

  test("reads a broken record as empty", () => {
    mkdirSync(join(folder, "state"), { recursive: true });
    writeFileSync(recordPath, "{ broken");
    expect(new DataFormatRecord(recordPath).get("Life/Habits")).toBeUndefined();
  });

  test("never writes through a link, or into a place that a widget may not reach", () => {
    mkdirSync(join(vault, "Elsewhere"));
    symlinkSync(join(vault, "Elsewhere"), join(vault, "Life", "Linked"), "dir");
    const written = writeDataFormats(
      vault,
      [
        { folder: "Life/Linked", text: first },
        { folder: "Scratch", text: first },
        { folder: "Life/Missing", text: first },
      ],
      record,
    );
    expect(written.written).toEqual([]);
    expect(existsSync(join(vault, "Elsewhere", "DATA_FORMAT.md"))).toBe(false);
    symlinkSync(join(vault, "Elsewhere", "x.md"), join(vault, "Life", "Habits", "DATA_FORMAT.md"));
    expect(writeDataFormats(vault, [{ folder: "Life/Habits", text: first }], record).written).toEqual([]);
  });
});
