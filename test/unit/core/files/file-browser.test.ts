import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseVault, maxShownBytes } from "../../../../src/core/files/file-browser.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let vault: string;
const keep = (text: string): string => text;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-browser-"));
  vault = join(folder, "vault");
  write("Methods/Plan.md", "# Plan\n");
  write("notes.txt", "Buy milk.\n");
  write(".eva/assistant.md", "# You are Eva\n");
  write(".git/config", "[core]\n");
  write("Projects/2025-03-02-1015-example-app/repos/example-app-0/main.py", "print('hi')\n");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Uint8Array): void {
  const path = join(vault, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function refusal(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return isEvaError(error, "file_not_found") ? error.message : "another error";
  }
}

describe("browseVault: folders", () => {
  test("the root lists its folders first, then its files, each by name, without .git", () => {
    const root = browseVault(vault, "", keep);
    expect(root).toEqual({
      kind: "folder",
      path: "",
      entries: [
        { name: ".eva", kind: "folder", size: null },
        { name: "Methods", kind: "folder", size: null },
        { name: "Projects", kind: "folder", size: null },
        { name: "notes.txt", kind: "file", size: 10 },
      ],
    });
  });

  test("a sub-folder opens by its forward-slash path, and a clone opens too", () => {
    expect(browseVault(vault, "Methods", keep)).toMatchObject({ kind: "folder", path: "Methods" });
    const clone = browseVault(vault, "Projects/2025-03-02-1015-example-app/repos/example-app-0", keep);
    expect(clone).toMatchObject({ entries: [{ name: "main.py", kind: "file" }] });
  });

  test("a trailing slash, a leading slash and a dot part give the same path", () => {
    expect(browseVault(vault, "/Methods/", keep)).toMatchObject({ path: "Methods" });
    expect(browseVault(vault, "./Methods", keep)).toMatchObject({ path: "Methods" });
  });
});

describe("browseVault: files", () => {
  test("a text file shows its text", () => {
    expect(browseVault(vault, "Methods/Plan.md", keep)).toEqual({
      kind: "file",
      path: "Methods/Plan.md",
      size: 7,
      text: "# Plan\n",
    });
  });

  test("the text passes through the redactor before it leaves the core", () => {
    const shown = browseVault(vault, "notes.txt", (text) => text.replace("milk", "[redacted]"));
    expect(shown).toMatchObject({ text: "Buy [redacted].\n" });
  });

  test("a binary file shows a reason instead of its content", () => {
    write("photo.png", new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13]));
    expect(browseVault(vault, "photo.png", keep)).toMatchObject({ kind: "unreadable", size: 8 });
  });

  test("a file that is not UTF-8 is not text", () => {
    write("latin.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(browseVault(vault, "latin.txt", keep)).toMatchObject({ kind: "unreadable" });
  });

  test("a file larger than the limit shows a reason", () => {
    write("big.log", "a".repeat(maxShownBytes + 1));
    expect(browseVault(vault, "big.log", keep)).toMatchObject({ kind: "unreadable", size: maxShownBytes + 1 });
  });

  test.each([".env", "Projects/2025-03-02-1015-example-app/repos/example-app-0/.env.local", "id.pem"])(
    "%s looks like a secrets file, so its text never shows",
    (path) => {
      write(path, "TOKEN=abc\n");
      expect(browseVault(vault, path, keep)).toMatchObject({ kind: "unreadable" });
    },
  );
});

describe("browseVault: refusals (lesson 72)", () => {
  test.each(["missing.md", "../outside.md", "Methods/../../outside.md", ".git", ".git/config"])(
    "%s is not found",
    (path) => {
      writeFileSync(join(folder, "outside.md"), "x");
      expect(refusal(() => browseVault(vault, path, keep))).not.toBeNull();
      expect(refusal(() => browseVault(vault, path, keep))).not.toBe("another error");
    },
  );

  test("a symbolic link that points out of the vault is listed but does not open", () => {
    mkdirSync(join(folder, "elsewhere"));
    writeFileSync(join(folder, "elsewhere", "secret.md"), "x");
    try {
      symlinkSync(join(folder, "elsewhere"), join(vault, "link"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    const root = browseVault(vault, "", keep);
    expect(root.kind === "folder" ? root.entries.find((entry) => entry.name === "link") : null).toEqual({
      name: "link",
      kind: "other",
      size: null,
    });
    expect(refusal(() => browseVault(vault, "link/secret.md", keep))).not.toBeNull();
  });

  test("a link inside the vault does not open git data or a secrets file", () => {
    write(".env", "SECRET=1\n");
    try {
      symlinkSync(join(vault, ".git"), join(vault, "g"), "junction");
      symlinkSync(join(vault, ".env"), join(vault, "harmless.txt"));
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    expect(refusal(() => browseVault(vault, "g/config", keep))).not.toBeNull();
    expect(browseVault(vault, "harmless.txt", keep)).toMatchObject({ kind: "unreadable" });
  });

  test.skipIf(process.platform === "win32")("elsewhere, a listed name with a colon opens", () => {
    write("Meeting 10:30.md", "# Notes\n");
    expect(browseVault(vault, "Meeting 10:30.md", keep)).toMatchObject({ kind: "file", text: "# Notes\n" });
  });

  test.if(process.platform === "win32")(
    "on Windows, a path part with a colon is a file stream, so it is not found",
    () => {
      expect(refusal(() => browseVault(vault, ".git::$INDEX_ALLOCATION/config", keep))).not.toBeNull();
    },
  );

  test("a vault that does not exist is not found", () => {
    expect(refusal(() => browseVault(join(folder, "none"), "", keep))).not.toBeNull();
  });
});

// Root reads any file, and Windows ignores the mode bits, so only another user sees the refusal.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "a folder that Eva may not read shows a reason instead of a failure",
  () => {
    mkdirSync(join(vault, "Locked"));
    chmodSync(join(vault, "Locked"), 0o000);
    try {
      expect(browseVault(vault, "Locked", keep)).toMatchObject({ kind: "unreadable" });
    } finally {
      chmodSync(join(vault, "Locked"), 0o755);
    }
  },
);
