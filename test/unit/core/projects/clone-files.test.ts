import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkMentions,
  copyVaultFileToClone,
  mentionsFolderName,
  saveInClone,
  withCloneMentions,
} from "../../../../src/core/projects/clone-files.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let vault: string;
let clone: string;

function write(path: string, text: string | Uint8Array): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function errorOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return isEvaError(error) ? error.code : String(error);
  }
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-clone-files-"));
  vault = join(folder, "vault");
  clone = join(vault, "Projects", "2026-01-01-0000-example-app", "repos", "clone-0");
  mkdirSync(join(clone, "example-app"), { recursive: true });
  write(join(vault, "Projects", "2026-01-01-0000-example-app", "Meeting.md"), "We chose the blue button.");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("copyVaultFileToClone", () => {
  test("copies the file into the clone's mention folder, named by its content", () => {
    const copy = copyVaultFileToClone(vault, clone, "Projects/2026-01-01-0000-example-app/Meeting.md");
    expect(copy).toMatch(/^\.mentions\/Meeting-[0-9a-f]{12}\.md$/);
    expect(readFileSync(join(clone, copy), "utf8")).toBe("We chose the blue button.");
  });

  test("gives the same bytes the same name, so a second mention adds no copy", () => {
    const first = copyVaultFileToClone(vault, clone, "Projects/2026-01-01-0000-example-app/Meeting.md");
    const second = copyVaultFileToClone(vault, clone, "Projects/2026-01-01-0000-example-app/Meeting.md");
    expect(second).toBe(first);
    expect(readdirSync(join(clone, mentionsFolderName))).toHaveLength(1);
  });

  test("never keeps the name of an instruction file, so the harness never loads a copy (lesson 2)", () => {
    write(join(vault, "AGENTS.md"), "Vault map.");
    const copy = copyVaultFileToClone(vault, clone, "AGENTS.md");
    expect(copy.toLowerCase().endsWith("/agents.md")).toBe(false);
  });

  test("copies an image as its bytes", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    write(join(vault, "Designs", "logo.png"), bytes);
    const copy = copyVaultFileToClone(vault, clone, "Designs/logo.png");
    expect(new Uint8Array(readFileSync(join(clone, copy)))).toEqual(bytes);
  });

  test("refuses a path out of the vault, a folder, a secret file and a file of a clone", () => {
    write(join(folder, "outside.md"), "Not in the vault.");
    write(join(vault, "Projects", "2026-01-01-0000-example-app", ".env.local"), "TOKEN=1");
    write(join(clone, "example-app", "README.md"), "Code.");
    expect(errorOf(() => copyVaultFileToClone(vault, clone, "../outside.md"))).toBe("file_not_downloadable");
    expect(errorOf(() => copyVaultFileToClone(vault, clone, "Projects"))).toBe("file_not_downloadable");
    expect(errorOf(() => copyVaultFileToClone(vault, clone, "Projects/2026-01-01-0000-example-app/.env.local"))).toBe(
      "file_not_downloadable",
    );
    expect(
      errorOf(() =>
        copyVaultFileToClone(vault, clone, "Projects/2026-01-01-0000-example-app/repos/clone-0/example-app/README.md"),
      ),
    ).toBe("file_not_downloadable");
    expect(existsSync(join(clone, mentionsFolderName))).toBe(false);
  });

  test("refuses a file that is gone", () => {
    expect(errorOf(() => copyVaultFileToClone(vault, clone, "Gone.md"))).toBe("file_not_found");
  });

  test("checks the real path, so `..`, `./` and a link cannot reach a clone (review of #716)", () => {
    write(join(clone, "example-app", "work.txt"), "Another chat's work.");
    const inClone = "Projects/2026-01-01-0000-example-app/repos/clone-0/example-app/work.txt";
    expect(errorOf(() => copyVaultFileToClone(vault, clone, `Notes/../${inClone}`))).toBe("file_not_downloadable");
    expect(errorOf(() => copyVaultFileToClone(vault, clone, `./${inClone}`))).toBe("file_not_downloadable");
    mkdirSync(join(vault, "Notes"), { recursive: true });
    // A junction needs no admin rights on Windows.
    symlinkSync(
      join(vault, "Projects", "2026-01-01-0000-example-app", "repos"),
      join(vault, "Notes", "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(errorOf(() => copyVaultFileToClone(vault, clone, "Notes/link/clone-0/example-app/work.txt"))).toBe(
      "file_not_downloadable",
    );
    expect(existsSync(join(clone, mentionsFolderName))).toBe(false);
  });

  test("refuses a file whose text holds a secret, as Telegram does when it sends a file", () => {
    write(join(vault, "Notes", "keys.txt"), "The key is ghp_0123456789abcdefghijklmnopqrstuvwxyzAB.");
    expect(errorOf(() => copyVaultFileToClone(vault, clone, "Notes/keys.txt"))).toBe("file_not_downloadable");
  });
});

describe("saveInClone", () => {
  test("saves a received file into the clone's mention folder, named by its content", () => {
    const saved = saveInClone(clone, "photo.jpg", new Uint8Array([1, 2, 3]));
    expect(saved).toMatch(/^\.mentions\/photo-[0-9a-f]{12}\.jpg$/);
    expect(new Uint8Array(readFileSync(join(clone, saved)))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("withCloneMentions", () => {
  test("puts the copy's name in place of the vault path, and adds a note with no vault path", () => {
    const text = withCloneMentions("Read @file:Projects/2026-01-01-0000-example-app/Meeting.md please.", vault, clone);
    expect(text).not.toContain("Projects/");
    expect(text).toMatch(
      /^Read @file:Meeting-[0-9a-f]{12}\.md please\.\n\n\[@file:Meeting-[0-9a-f]{12}\.md is the file \.mentions\/Meeting-[0-9a-f]{12}\.md\]$/,
    );
  });

  test("a file that is gone or refused gets its base name and a note that says why", () => {
    const text = withCloneMentions("Read @file:Notes/Gone.md", vault, clone);
    expect(text).toBe(
      "Read @file:Gone.md\n\n[@file:Gone.md: Eva could not give this file to the chat. Gone.md does not exist.]",
    );
  });

  test("leaves a text with no file mention as it is, and drops a project note's vault folder", () => {
    expect(withCloneMentions("Plain text.", vault, clone)).toBe("Plain text.");
    // A project mention would name a vault folder, so the chat gets the bare token only.
    expect(withCloneMentions("See @project:example-app", vault, clone)).toBe("See @project:example-app");
  });
});

describe("checkMentions", () => {
  test("passes a text whose files can be copied, and names the first one that cannot", () => {
    expect(() => checkMentions(vault, "Read @file:Projects/2026-01-01-0000-example-app/Meeting.md")).not.toThrow();
    expect(errorOf(() => checkMentions(vault, "Read @file:Notes/Gone.md"))).toBe("file_not_found");
  });
});
