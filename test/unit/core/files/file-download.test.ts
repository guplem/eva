import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVaultPath } from "../../../../src/core/files/file-download.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let vault: string;
const keep = (text: string): string => text;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-download-"));
  vault = join(folder, "vault");
  write("Methods/Plan.md", "# Plan\n");
  write("Methods/Deep/Step.md", "# Step\n");
  write("notes.txt", "Buy milk.\n");
  write(".git/config", "[core]\n");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Uint8Array): void {
  const path = join(vault, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function codeOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return isEvaError(error) ? error.code : "another error";
  }
}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly data: Uint8Array;
}

/** Reads each local entry of a zip, then checks that the central directory names the same entries. */
function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({ name, method, crc, data: bytes.subarray(dataStart, dataStart + size) });
    offset = dataStart + size;
  }
  const end = bytes.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(entries.length);
  expect(view.getUint32(end + 16, true)).toBe(offset);
  return entries;
}

const textOf = (entry: ZipEntry | undefined): string => new TextDecoder().decode(entry?.data);

describe("downloadVaultPath: files", () => {
  test("a text file comes as its own bytes, under its own name", () => {
    const download = downloadVaultPath(vault, "notes.txt", keep);
    expect(download).toMatchObject({ name: "notes.txt", zip: false });
    expect(new TextDecoder().decode(download.bytes)).toBe("Buy milk.\n");
  });

  test("a binary file larger than the shown limit comes whole, such as a PDF", () => {
    const pdf = new Uint8Array(1_500_000);
    pdf.set(new TextEncoder().encode("%PDF-1.7"));
    write("Docs/report.pdf", pdf);
    const download = downloadVaultPath(vault, "Docs/report.pdf", keep);
    expect(download.name).toBe("report.pdf");
    expect(download.bytes).toEqual(pdf);
  });

  test("the text of a text file passes through the redactor, so a secret never leaves the core", () => {
    const download = downloadVaultPath(vault, "notes.txt", (text) => text.replace("milk", "[redacted]"));
    expect(new TextDecoder().decode(download.bytes)).toBe("Buy [redacted].\n");
  });

  test("a secrets file, a path out of the vault and git data do not download", () => {
    write(".env", "SECRET=1\n");
    writeFileSync(join(folder, "outside.md"), "x");
    expect(codeOf(() => downloadVaultPath(vault, ".env", keep))).toBe("file_not_downloadable");
    expect(codeOf(() => downloadVaultPath(vault, "../outside.md", keep))).toBe("file_not_found");
    expect(codeOf(() => downloadVaultPath(vault, ".git/config", keep))).toBe("file_not_found");
    expect(codeOf(() => downloadVaultPath(vault, "missing.md", keep))).toBe("file_not_found");
  });

  test("a file larger than the limit does not download", () => {
    write("big.bin", new Uint8Array(2_000));
    expect(codeOf(() => downloadVaultPath(vault, "big.bin", keep, 1_000))).toBe("file_not_downloadable");
  });
});

describe("downloadVaultPath: folders", () => {
  test("a folder comes as one zip, with no compression, and opens as a folder of its own name", () => {
    const download = downloadVaultPath(vault, "Methods", keep);
    expect(download).toMatchObject({ name: "Methods.zip", zip: true });
    const entries = readZip(download.bytes);
    expect(entries.map((entry) => entry.name)).toEqual([
      "Methods/",
      "Methods/Deep/",
      "Methods/Deep/Step.md",
      "Methods/Plan.md",
    ]);
    expect(entries.every((entry) => entry.method === 0)).toBe(true);
    const plan = entries.find((entry) => entry.name === "Methods/Plan.md");
    expect(textOf(plan)).toBe("# Plan\n");
    expect(plan?.crc).toBe(Bun.hash.crc32(new TextEncoder().encode("# Plan\n")));
  });

  test("the vault root zips under the vault's name, without git data or a secrets file", () => {
    write(".env", "SECRET=1\n");
    write("Empty/.gitkeep", "");
    const entries = readZip(downloadVaultPath(vault, "", keep).bytes);
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("vault/notes.txt");
    expect(names).toContain("vault/Empty/.gitkeep");
    expect(names.some((name) => name.includes(".git/") || name.endsWith(".env"))).toBe(false);
  });

  test("a zipped text file passes through the redactor, and a name keeps its accents", () => {
    write("Methods/Café.md", "Buy milk.\n");
    const entries = readZip(downloadVaultPath(vault, "Methods", (text) => text.replace("milk", "[redacted]")).bytes);
    const cafe = entries.find((entry) => entry.name === "Methods/Café.md");
    expect(textOf(cafe)).toBe("Buy [redacted].\n");
    expect(cafe?.crc).toBe(Bun.hash.crc32(new TextEncoder().encode("Buy [redacted].\n")));
  });

  test("a link out of the vault and a link back to a parent folder stay out of the zip", () => {
    mkdirSync(join(folder, "elsewhere"));
    writeFileSync(join(folder, "elsewhere", "secret.md"), "x");
    try {
      symlinkSync(join(folder, "elsewhere"), join(vault, "Methods", "out"), "junction");
      symlinkSync(join(vault, "Methods"), join(vault, "Methods", "Deep", "loop"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    const names = readZip(downloadVaultPath(vault, "Methods", keep).bytes).map((entry) => entry.name);
    expect(names).toEqual(["Methods/", "Methods/Deep/", "Methods/Deep/Step.md", "Methods/Plan.md"]);
  });

  test("a folder larger than the limit does not download", () => {
    write("Methods/big.bin", new Uint8Array(2_000));
    expect(codeOf(() => downloadVaultPath(vault, "Methods", keep, 1_000))).toBe("file_not_downloadable");
  });
});

describe("downloadVaultPath: the vault's secret files (#707)", () => {
  const encrypted =
    "Encrypted by Eva. Open this file in Eva's Files page to read it.\neva-encrypted-v1 0123456789abcdef\nAAAA\n";

  test("an encrypted file, whatever its name, sends the person to the Files page", () => {
    write("Notes/copy.md", encrypted);
    let message = "";
    try {
      downloadVaultPath(vault, "Notes/copy.md", keep);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("Files page");
  });

  test("a pattern of the person's own list stops a download, and the zip leaves it and each encrypted file out", () => {
    write(".eva/secret-files", "Private/**\n");
    write("Private/plan.md", "x");
    write("Notes/copy.md", encrypted);
    write("Notes/keep.md", "keep\n");
    expect(codeOf(() => downloadVaultPath(vault, "Private/plan.md", keep))).toBe("file_not_downloadable");
    const names = readZip(downloadVaultPath(vault, "", keep).bytes).map((entry) => entry.name);
    expect(names).toContain("vault/Notes/keep.md");
    expect(names).not.toContain("vault/Notes/copy.md");
    expect(names).not.toContain("vault/Private/plan.md");
  });
});
