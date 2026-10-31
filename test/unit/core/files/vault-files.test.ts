import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanScratch,
  isClonePath,
  OfferStore,
  receivedFileNote,
  resolveSendableFile,
  saveReceivedFile,
} from "../../../../src/core/files/vault-files.ts";

let folder: string;
let vault: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-files-"));
  vault = join(folder, "vault");
  mkdirSync(join(vault, "Methods"), { recursive: true });
  writeFileSync(join(vault, "Methods", "Plan.md"), "# Plan\n");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const path = join(vault, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("resolveSendableFile (lesson 72)", () => {
  test("a note in the vault can be sent, with a forward-slash path", () => {
    const file = resolveSendableFile(vault, "Methods/Plan.md");
    expect(file).toMatchObject({ ok: true, relativePath: "Methods/Plan.md", name: "Plan.md" });
  });

  test("a path that leads into Scratch from elsewhere in the vault is accepted (lesson 73)", () => {
    write("Scratch/answer.pdf", "pdf");
    expect(resolveSendableFile(vault, "Methods/../Scratch/answer.pdf")).toMatchObject({
      ok: true,
      relativePath: "Scratch/answer.pdf",
    });
  });

  test.each([
    ["Missing.md", "does not exist"],
    ["Methods", "is not a file"],
  ])("%s is refused: %s", (requested, reason) => {
    expect(resolveSendableFile(vault, requested)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(reason) as string,
    });
  });

  test("a path outside the vault is refused, even through `..`", () => {
    writeFileSync(join(folder, "outside.md"), "x");
    expect(resolveSendableFile(vault, "../outside.md")).toEqual({
      ok: false,
      reason: "../outside.md is outside the vault, so Eva does not send it.",
    });
  });

  test("an absolute path is refused", () => {
    expect(resolveSendableFile(vault, join(vault, "Methods", "Plan.md")).ok).toBe(false);
  });

  test("a symbolic link that points out of the vault is refused", () => {
    writeFileSync(join(folder, "outside.md"), "x");
    try {
      symlinkSync(join(folder, "outside.md"), join(vault, "link.md"));
    } catch {
      return; // Windows without developer mode cannot make a link; the `..` test covers the rule.
    }
    expect(resolveSendableFile(vault, "link.md")).toMatchObject({ ok: false });
  });

  test.each([
    [".git/config", "repository folder"],
    ["Projects/2025-03-02-1015-example-app/repos/example-app-0/notes.md", "repository folder"],
    ["Projects/2025-03-02-1015-example-app/.env.local", "secret file"],
    ["Projects/2025-03-02-1015-example-app/server.pem", "secret file"],
  ])("%s is refused: %s", (relativePath, reason) => {
    write(relativePath, "x");
    expect(resolveSendableFile(vault, relativePath)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(reason) as string,
    });
  });

  test("a file that holds a secret is refused", () => {
    write("Methods/Keys.md", "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789\n");
    expect(resolveSendableFile(vault, "Methods/Keys.md")).toEqual({
      ok: false,
      reason: "Methods/Keys.md holds a secret, so Eva does not send it.",
    });
  });

  test("a file over 50 MB is refused", () => {
    write("Big.bin", "");
    writeFileSync(join(vault, "Big.bin"), new Uint8Array(50 * 1024 * 1024 + 1));
    expect(resolveSendableFile(vault, "Big.bin")).toEqual({ ok: false, reason: "Big.bin is larger than 50 MB." });
  });
});

describe("names that Windows and macOS read in another way (review of #716)", () => {
  test("a clone path matches in any case, since those systems find `projects/x/REPOS` too", () => {
    expect(isClonePath("projects/example-app/REPOS/clone-0/a.md")).toBe(true);
    expect(isClonePath("Projects/example-app/repos")).toBe(true);
    expect(isClonePath("Projects/example-app/notes.md")).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "a secret name with a trailing dot or space still counts, since Windows drops them",
    () => {
      write("Notes/.env.local.", "x");
      write("Notes/credentials.json ", "x");
      write("Notes/notes.md.", "x");
      expect(resolveSendableFile(vault, "Notes/.env.local.")).toMatchObject({ ok: false });
      expect(resolveSendableFile(vault, "Notes/credentials.json ")).toMatchObject({ ok: false });
      expect(resolveSendableFile(vault, "Notes/notes.md.")).toMatchObject({ ok: true });
    },
  );

  test("the person's own pattern and Eva's header both mark a secret, whatever the name (#707)", () => {
    write(".eva/secret-files", "Private/**\n");
    write("Private/plan.md", "x");
    write(
      "Notes/copy.md",
      "Encrypted by Eva. Open this file in Eva's Files page to read it.\neva-encrypted-v1 0123456789abcdef\nAAAA\n",
    );
    expect(resolveSendableFile(vault, "Private/plan.md")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("secret file") as string,
    });
    expect(resolveSendableFile(vault, "Notes/copy.md")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("encrypted") as string,
    });
  });

  test.skipIf(process.platform !== "win32")("a colon is refused on Windows, where it opens a file stream", () => {
    expect(resolveSendableFile(vault, "Methods/Plan.md::$DATA").ok).toBe(false);
  });
});

describe("OfferStore (lesson 124)", () => {
  test("the same path keeps the same id, across a restart", () => {
    const path = join(folder, "state", "offers.json");
    const id = new OfferStore(path).idFor("Methods/Plan.md");
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(new OfferStore(path).idFor("Methods/Plan.md")).toBe(id);
    expect(new OfferStore(path).pathFor(id)).toBe("Methods/Plan.md");
    expect(new OfferStore(path).pathFor("unknown")).toBeNull();
  });

  test("a broken store file means no offers, never a crash", () => {
    const path = join(folder, "offers.json");
    writeFileSync(path, "{ broken");
    expect(new OfferStore(path).pathFor("x")).toBeNull();
    writeFileSync(path, JSON.stringify({ a: 5, b: "Methods/Plan.md" }));
    expect(new OfferStore(path).pathFor("a")).toBeNull();
    expect(new OfferStore(path).pathFor("b")).toBe("Methods/Plan.md");
  });
});

describe("received files and the scratch cleanup", () => {
  test("a received file is named by its content, so two files with one name never collide (lesson 74)", () => {
    const first = saveReceivedFile(vault, "photo.jpg", new Uint8Array([1, 2, 3]));
    const second = saveReceivedFile(vault, "photo.jpg", new Uint8Array([4, 5, 6]));
    expect(first).toMatch(/^Scratch\/received\/photo-[0-9a-f]{12}\.jpg$/);
    expect(second).not.toBe(first);
    expect([...readFileSync(join(vault, first))]).toEqual([1, 2, 3]);
  });

  test("a hostile name cannot leave the folder", () => {
    const saved = saveReceivedFile(vault, "../../evil name?.sh", new Uint8Array([1]));
    expect(saved).toMatch(/^Scratch\/received\/[\w.-]+-[0-9a-f]{12}\.sh$/);
    expect(saved).not.toContain("..");
    expect(existsSync(join(vault, saved))).toBe(true);
    expect(saveReceivedFile(vault, "", new Uint8Array([2]))).toMatch(/^Scratch\/received\/file-[0-9a-f]{12}$/);
  });

  test("a name in any language keeps its letters (issue 409)", () => {
    expect(saveReceivedFile(vault, "写真 día.jpg", new Uint8Array([3]))).toMatch(
      /^Scratch\/received\/写真-día-[0-9a-f]{12}\.jpg$/,
    );
    expect(saveReceivedFile(vault, "हिन्दी.txt", new Uint8Array([4]))).toMatch(
      /^Scratch\/received\/हिन्दी-[0-9a-f]{12}\.txt$/,
    );
  });

  test("a long name in a script of several bytes a letter still fits the file system", () => {
    // Letters of 4 bytes, and an extension of odd length, so a cut by UTF-16 units splits a letter in two.
    const saved = saveReceivedFile(vault, `${"𠀀".repeat(100)}.jpeg`, new Uint8Array([5]));
    expect(saved).toMatch(/^Scratch\/received\/(𠀀)+-[0-9a-f]{12}\.jpeg$/u);
    expect(existsSync(join(vault, saved))).toBe(true);
  });

  test("the note tells the agent where a received file is", () => {
    expect(receivedFileNote("Scratch/received/a-1.jpg")).toBe(
      "[The person sent a file, saved as Scratch/received/a-1.jpg]",
    );
  });

  test("files older than a week are removed, newer ones stay", () => {
    write("Scratch/old.pdf", "old");
    write("Scratch/received/new.jpg", "new");
    const now = new Date();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    utimesSync(join(vault, "Scratch", "old.pdf"), eightDaysAgo, eightDaysAgo);
    expect(cleanScratch(vault, now)).toBe(1);
    expect(existsSync(join(vault, "Scratch", "old.pdf"))).toBe(false);
    expect(existsSync(join(vault, "Scratch", "received", "new.jpg"))).toBe(true);
  });

  test("a file that goes away during the cleanup is skipped, and the cleanup goes on", () => {
    write("Scratch/a-gone.pdf", "gone");
    write("Scratch/b-old.pdf", "old");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    utimesSync(join(vault, "Scratch", "b-old.pdf"), eightDaysAgo, eightDaysAgo);
    const real = fs.statSync;
    const stat = spyOn(fs, "statSync").mockImplementation(((path: string, ...rest: unknown[]) => {
      if (path.endsWith("a-gone.pdf")) throw Object.assign(new Error("ENOENT: gone"), { code: "ENOENT" });
      return (real as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.statSync);
    try {
      expect(cleanScratch(vault, new Date())).toBe(1);
    } finally {
      stat.mockRestore();
    }
    expect(existsSync(join(vault, "Scratch", "b-old.pdf"))).toBe(false);
  });

  test("a vault without Scratch cleans nothing", () => {
    expect(cleanScratch(join(folder, "nowhere"), new Date())).toBe(0);
  });
});

describe("security review", () => {
  test("the Scratch cleanup never follows a link out of Scratch", () => {
    const outside = join(folder, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "mine");
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    utimesSync(join(outside, "keep.txt"), old, old);
    mkdirSync(join(vault, "Scratch"), { recursive: true });
    try {
      symlinkSync(outside, join(vault, "Scratch", "link"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    cleanScratch(vault, new Date());
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });

  test.each([".npmrc", "secrets.json", "credentials.json", "client_secret_123.json", "cert.p12"])(
    "%s is refused as a secrets file",
    (name) => {
      write(`Notes/${name}`, "x");
      expect(resolveSendableFile(vault, `Notes/${name}`)).toMatchObject({ ok: false });
    },
  );
});
