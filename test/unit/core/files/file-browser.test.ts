import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browseVault,
  maxShownBytes,
  renameVaultEntry,
  saveVaultFile,
} from "../../../../src/core/files/file-browser.ts";
import { fileVersion } from "../../../../src/core/projects/project-file.ts";
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

  test("Projects lists each project folder with the title of its AGENTS.md (issue 429)", () => {
    write("Projects/2025-03-02-1015-example-app/AGENTS.md", "---\ncreated: 2025-03-02T10:15\n---\n# Example app\n");
    write("Projects/2026-01-01-0000-untitled/AGENTS.md", "---\ncreated: 2026-01-01T00:00\n---\nNo heading.\n");
    write("Projects/not-a-project/AGENTS.md", "---\ncreated: 2026\n---\n# Not a project\n");
    write("Projects/2026-02-02-0000-no-front-matter/AGENTS.md", "# No front matter\n");
    expect(browseVault(vault, "Projects", keep)).toMatchObject({
      entries: [
        { name: "2025-03-02-1015-example-app", kind: "folder", size: null, title: "Example app" },
        { name: "2026-01-01-0000-untitled", kind: "folder", size: null },
        { name: "2026-02-02-0000-no-front-matter", kind: "folder", size: null },
        { name: "not-a-project", kind: "folder", size: null },
      ],
    });
    const entries = browseVault(vault, "Projects", keep);
    if (entries.kind !== "folder") throw new Error("Projects is a folder");
    expect(entries.entries.filter((entry) => entry.title !== undefined)).toHaveLength(1);
  });

  test("an AGENTS.md link that leads out of the vault gives no title", () => {
    writeFileSync(join(folder, "outside.md"), "---\ncreated: 2026-01-01T00:00\n---\n# Private line\n");
    mkdirSync(join(vault, "Projects/2026-01-01-0000-linked"), { recursive: true });
    try {
      symlinkSync(join(folder, "outside.md"), join(vault, "Projects/2026-01-01-0000-linked/AGENTS.md"));
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    const projects = browseVault(vault, "Projects", keep);
    if (projects.kind !== "folder") throw new Error("Projects is a folder");
    expect(projects.entries.find((entry) => entry.name === "2026-01-01-0000-linked")).toEqual({
      name: "2026-01-01-0000-linked",
      kind: "folder",
      size: null,
    });
  });

  test("a large AGENTS.md gives its title from the start of the file", () => {
    write(
      "Projects/2026-01-01-0000-large/AGENTS.md",
      `---\ncreated: 2026-01-01T00:00\n---\n# Large\n\n${"A long line.\n".repeat(20_000)}`,
    );
    const projects = browseVault(vault, "Projects", keep);
    if (projects.kind !== "folder") throw new Error("Projects is a folder");
    expect(projects.entries.find((entry) => entry.name === "2026-01-01-0000-large")?.title).toBe("Large");
  });

  test("a letter of two bytes across the read limit keeps the title", () => {
    const head = "---\ncreated: 2026-01-01T00:00\n---\n# Cut\n\n";
    // "à" takes two bytes, and the first one is the last byte that the title read takes.
    const filler = "x".repeat(64_000 - Buffer.byteLength(head) - 1);
    write("Projects/2026-01-01-0000-cut/AGENTS.md", `${head}${filler}à and more text\n`);
    const projects = browseVault(vault, "Projects", keep);
    if (projects.kind !== "folder") throw new Error("Projects is a folder");
    expect(projects.entries.find((entry) => entry.name === "2026-01-01-0000-cut")?.title).toBe("Cut");
  });

  test.skipIf(process.platform === "win32")("an AGENTS.md that is a named pipe never blocks the core", () => {
    mkdirSync(join(vault, "Projects/2026-01-01-0000-pipe"), { recursive: true });
    const made = Bun.spawnSync(["mkfifo", join(vault, "Projects/2026-01-01-0000-pipe/AGENTS.md")]);
    if (made.exitCode !== 0) return; // A system without mkfifo cannot hold a named pipe here.
    const projects = browseVault(vault, "Projects", keep);
    if (projects.kind !== "folder") throw new Error("Projects is a folder");
    expect(projects.entries.find((entry) => entry.name === "2026-01-01-0000-pipe")).toEqual({
      name: "2026-01-01-0000-pipe",
      kind: "folder",
      size: null,
    });
  });

  test("a folder outside Projects gets no title, even with an AGENTS.md", () => {
    write("Methods/2025-03-02-1015-example-app/AGENTS.md", "---\ncreated: 2025-03-02T10:15\n---\n# Example app\n");
    const methods = browseVault(vault, "Methods", keep);
    if (methods.kind !== "folder") throw new Error("Methods is a folder");
    expect(methods.entries.every((entry) => entry.title === undefined)).toBe(true);
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
      version: fileVersion("# Plan\n"),
      editable: true,
    });
  });

  test("the text passes through the redactor before it leaves the core", () => {
    const shown = browseVault(vault, "notes.txt", (text) => text.replace("milk", "[redacted]"));
    // A save would write the mark over the secret, so the file is read only.
    expect(shown).toMatchObject({ text: "Buy [redacted].\n", editable: false });
  });

  test("a binary file shows a reason instead of its content", () => {
    write("photo.png", new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13]));
    expect(browseVault(vault, "photo.png", keep)).toMatchObject({ kind: "unreadable", size: 8, downloadable: true });
  });

  test("a file that is not UTF-8 is not text", () => {
    write("latin.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(browseVault(vault, "latin.txt", keep)).toMatchObject({ kind: "unreadable" });
  });

  test("a file larger than the limit shows a reason", () => {
    write("big.log", "a".repeat(maxShownBytes + 1));
    expect(browseVault(vault, "big.log", keep)).toMatchObject({
      kind: "unreadable",
      size: maxShownBytes + 1,
      downloadable: true,
    });
  });

  test.each([".env", "Projects/2025-03-02-1015-example-app/repos/example-app-0/.env.local", "id.pem"])(
    "%s looks like a secrets file, so its text never shows",
    (path) => {
      write(path, "TOKEN=abc\n");
      expect(browseVault(vault, path, keep)).toMatchObject({ kind: "unreadable", downloadable: false });
    },
  );

  test("an encrypted file shows as encrypted, whatever its name, and a listed file waits for its encryption (#707)", () => {
    const encrypted =
      "Encrypted by Eva. Open this file in Eva's Files page to read it.\neva-encrypted-v1 0123456789abcdef\nAAAA\n";
    write("Notes/copy.md", encrypted);
    write(".eva/secret-files", "Private/**\n");
    write("Private/plan.md", "x");
    expect(browseVault(vault, "Notes/copy.md", keep)).toEqual({
      kind: "encrypted",
      path: "Notes/copy.md",
      size: encrypted.length,
    });
    expect(browseVault(vault, "Private/plan.md", keep)).toMatchObject({ kind: "unreadable", downloadable: false });
  });
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
    expect(browseVault(vault, "harmless.txt", keep)).toMatchObject({ kind: "unreadable", downloadable: false });
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
      expect(browseVault(vault, "Locked", keep)).toMatchObject({ kind: "unreadable", downloadable: false });
    } finally {
      chmodSync(join(vault, "Locked"), 0o755);
    }
  },
);

describe("saveVaultFile (issue 308)", () => {
  const versionOf = (relativePath: string): string => {
    const shown = browseVault(vault, relativePath, keep);
    if (shown.kind !== "file") throw new Error(`${relativePath} is not a text file.`);
    return shown.version;
  };
  const codeOf = (action: () => unknown): string | null => {
    try {
      action();
      return null;
    } catch (error) {
      return isEvaError(error) ? error.code : "another error";
    }
  };

  test("a save writes the text and answers the file with its new version", () => {
    const saved = saveVaultFile(vault, "notes.txt", versionOf("notes.txt"), "Buy bread.\n", keep);
    expect(saved).toMatchObject({ kind: "file", path: "notes.txt", text: "Buy bread.\n", size: 11, editable: true });
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy bread.\n");
    expect(saved.kind === "file" && saved.version).toBe(versionOf("notes.txt"));
  });

  test("a save keeps the line endings and the byte order mark of the file on disk", () => {
    write("windows.md", "﻿one\r\ntwo\r\n");
    saveVaultFile(vault, "windows.md", versionOf("windows.md"), "one\nthree\n", keep);
    expect(readFileSync(join(vault, "windows.md"), "utf-8")).toBe("﻿one\r\nthree\r\n");
  });

  test.skipIf(process.platform === "win32")("a save keeps the mode of the file, so git sees no mode change", () => {
    write("run.sh", "echo hi\n");
    chmodSync(join(vault, "run.sh"), 0o755);
    saveVaultFile(vault, "run.sh", versionOf("run.sh"), "echo bye\n", keep);
    expect(statSync(join(vault, "run.sh")).mode & 0o777).toBe(0o755);
  });

  test("a save that names an old version is refused, so a newer change is never lost", () => {
    const version = versionOf("notes.txt");
    write("notes.txt", "Buy eggs.\n");
    expect(codeOf(() => saveVaultFile(vault, "notes.txt", version, "Buy bread.\n", keep))).toBe("file_changed");
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy eggs.\n");
  });

  test("a file with a redacted secret is refused, so the mark never replaces the secret", () => {
    const redact = (text: string): string => text.replace("milk", "[redacted]");
    const version = versionOf("notes.txt");
    expect(codeOf(() => saveVaultFile(vault, "notes.txt", version, "Buy [redacted].\n", redact))).toBe(
      "file_not_writable",
    );
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy milk.\n");
  });

  test("a text that holds a secret is refused: the sweep would push it from the vault", () => {
    const redact = (text: string): string => text.replace("ghp_secret", "[redacted]");
    const save = (): unknown => saveVaultFile(vault, "notes.txt", versionOf("notes.txt"), "Token ghp_secret\n", redact);
    expect(codeOf(save)).toBe("file_not_writable");
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy milk.\n");
  });

  test.skipIf(process.platform === "win32")("a save never writes through a link at its temporary name", () => {
    write("../outside.txt", "Keep me.\n");
    const now = Date.now;
    Date.now = () => 1;
    try {
      symlinkSync(join(folder, "outside.txt"), join(vault, `notes.txt.${String(process.pid)}.1.tmp`));
      saveVaultFile(vault, "notes.txt", versionOf("notes.txt"), "Buy bread.\n", keep);
    } catch {
      // A refusal is fine too: only the file outside matters.
    } finally {
      Date.now = now;
    }
    expect(readFileSync(join(folder, "outside.txt"), "utf-8")).toBe("Keep me.\n");
  });

  test("a folder, a binary file, a secrets file and a text over the limit are refused", () => {
    write("photo.png", new Uint8Array([137, 80, 0, 71]));
    write(".env", "TOKEN=abc\n");
    expect(codeOf(() => saveVaultFile(vault, "Methods", "any", "text", keep))).toBe("file_not_writable");
    expect(codeOf(() => saveVaultFile(vault, "photo.png", "any", "text", keep))).toBe("file_not_writable");
    expect(codeOf(() => saveVaultFile(vault, ".env", "any", "TOKEN=\n", keep))).toBe("file_not_writable");
    const tooLarge = "a".repeat(maxShownBytes + 1);
    expect(codeOf(() => saveVaultFile(vault, "notes.txt", versionOf("notes.txt"), tooLarge, keep))).toBe(
      "file_not_writable",
    );
  });

  test("a save never creates a file, and never leaves the vault or writes git data", () => {
    expect(codeOf(() => saveVaultFile(vault, "new.md", "any", "text", keep))).toBe("file_not_found");
    expect(codeOf(() => saveVaultFile(vault, "../outside.md", "any", "text", keep))).toBe("file_not_found");
    expect(codeOf(() => saveVaultFile(vault, ".git/config", "any", "text", keep))).toBe("file_not_found");
    expect(existsSync(join(vault, "new.md"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("a save through a link changes the target and keeps the link", () => {
    symlinkSync(join(vault, "notes.txt"), join(vault, "link.txt"));
    saveVaultFile(vault, "link.txt", versionOf("link.txt"), "Buy tea.\n", keep);
    expect(lstatSync(join(vault, "link.txt")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy tea.\n");
  });
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "a save into a folder that Eva cannot write is refused, and leaves no temporary file (issue 308)",
  () => {
    write("Locked/note.md", "# Note\n");
    const shown = browseVault(vault, "Locked/note.md", keep);
    chmodSync(join(vault, "Locked"), 0o555);
    try {
      const version = shown.kind === "file" ? shown.version : "";
      expect(() => saveVaultFile(vault, "Locked/note.md", version, "# Changed\n", keep)).toThrow(
        "Eva has no permission to change this.",
      );
      expect(readdirSync(join(vault, "Locked"))).toEqual(["note.md"]);
    } finally {
      chmodSync(join(vault, "Locked"), 0o755);
    }
  },
);

describe("renameVaultEntry (issue 343)", () => {
  const codeOf = (action: () => unknown): string | null => {
    try {
      action();
      return null;
    } catch (error) {
      return isEvaError(error) ? error.code : "another error";
    }
  };

  test("a file and a folder get the new name and answer their new path", () => {
    expect(renameVaultEntry(vault, "notes.txt", "shopping.txt")).toBe("shopping.txt");
    expect(readFileSync(join(vault, "shopping.txt"), "utf-8")).toBe("Buy milk.\n");
    expect(existsSync(join(vault, "notes.txt"))).toBe(false);
    expect(renameVaultEntry(vault, "Methods", "Ways")).toBe("Ways");
    expect(readFileSync(join(vault, "Ways/Plan.md"), "utf-8")).toBe("# Plan\n");
    expect(renameVaultEntry(vault, "Ways/Plan.md", "Plan B.md")).toBe("Ways/Plan B.md");
  });

  test("the same name changes nothing, and a change of case renames the entry", () => {
    expect(renameVaultEntry(vault, "notes.txt", "notes.txt")).toBe("notes.txt");
    expect(renameVaultEntry(vault, "notes.txt", "Notes.txt")).toBe("Notes.txt");
    expect(readdirSync(vault)).toContain("Notes.txt");
    expect(readdirSync(vault)).not.toContain("notes.txt");
  });

  test("a name that is there already is refused, so no entry is lost", () => {
    write("other.txt", "Keep me.\n");
    expect(codeOf(() => renameVaultEntry(vault, "notes.txt", "other.txt"))).toBe("file_not_writable");
    expect(codeOf(() => renameVaultEntry(vault, "notes.txt", "Methods"))).toBe("file_not_writable");
    expect(readFileSync(join(vault, "other.txt"), "utf-8")).toBe("Keep me.\n");
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy milk.\n");
  });

  test("a name that another machine could not hold is refused", () => {
    for (const name of ["", ".", "..", "a/b", "a\\b", "a:b", "what?", "end.", "end ", "CON", "nul.txt", "a\u0001b"])
      expect(codeOf(() => renameVaultEntry(vault, "notes.txt", name))).toBe("file_not_writable");
    expect(codeOf(() => renameVaultEntry(vault, "notes.txt", "x".repeat(256)))).toBe("file_not_writable");
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy milk.\n");
  });

  test("git data and secrets files stay out of reach", () => {
    write(".env", "TOKEN=abc\n");
    expect(codeOf(() => renameVaultEntry(vault, "notes.txt", ".git"))).toBe("file_not_writable");
    expect(codeOf(() => renameVaultEntry(vault, "notes.txt", ".GIT"))).toBe("file_not_writable");
    expect(codeOf(() => renameVaultEntry(vault, ".git", "data"))).toBe("file_not_found");
    expect(codeOf(() => renameVaultEntry(vault, ".git/config", "other"))).toBe("file_not_found");
    expect(codeOf(() => renameVaultEntry(vault, ".env", "env.txt"))).toBe("file_not_writable");
    expect(codeOf(() => renameVaultEntry(vault, "notes.txt", ".env"))).toBe("file_not_writable");
    expect(existsSync(join(vault, ".env"))).toBe(true);
  });

  test("the vault layout keeps its names: .eva, Projects, each project, its repos and each clone", () => {
    const project = "Projects/2025-03-02-1015-example-app";
    for (const path of [".eva", "Projects", project, `${project}/repos`, `${project}/repos/example-app-0`])
      expect(codeOf(() => renameVaultEntry(vault, path, "renamed"))).toBe("file_not_writable");
    write("Library/book.md", "# Book\n");
    expect(codeOf(() => renameVaultEntry(vault, "Library", "Projects"))).toBe("file_not_writable");
    // A file inside a clone or a project is the person's own work.
    expect(renameVaultEntry(vault, `${project}/repos/example-app-0/main.py`, "app.py")).toBe(
      `${project}/repos/example-app-0/app.py`,
    );
  });

  test("the vault root, a missing entry and a path out of the vault are refused", () => {
    expect(codeOf(() => renameVaultEntry(vault, "", "Vault"))).toBe("file_not_writable");
    expect(codeOf(() => renameVaultEntry(vault, "missing.md", "found.md"))).toBe("file_not_found");
    expect(codeOf(() => renameVaultEntry(vault, "../vault", "other"))).toBe("file_not_found");
    expect(codeOf(() => renameVaultEntry(vault, "Methods/..", "other"))).toBe("file_not_found");
  });

  test.skipIf(process.platform === "win32")("a link gets the new name, and its target keeps its own", () => {
    symlinkSync(join(vault, "notes.txt"), join(vault, "link.txt"));
    expect(renameVaultEntry(vault, "link.txt", "shortcut.txt")).toBe("shortcut.txt");
    expect(lstatSync(join(vault, "shortcut.txt")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(vault, "notes.txt"), "utf-8")).toBe("Buy milk.\n");
  });
});
