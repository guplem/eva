import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  existsSync,
  lutimesSync,
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
  scratchFolders,
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

/** A vault from before #767: its .gitignore names the old Scratch/, which Eva still cleans. */
function oldVault(): void {
  write(".gitignore", "Projects/*/repos/\nScratch/\n");
}

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

  test("a path that leads into .eva/scratch from elsewhere in the vault is accepted (lesson 73)", () => {
    write(".eva/scratch/answer.pdf", "pdf");
    expect(resolveSendableFile(vault, "Methods/../.eva/scratch/answer.pdf")).toMatchObject({
      ok: true,
      relativePath: ".eva/scratch/answer.pdf",
    });
  });

  test("a file that Eva sent from the old Scratch/ still opens from its link (#767)", () => {
    write("Scratch/answer.pdf", "pdf");
    expect(resolveSendableFile(vault, "Scratch/answer.pdf")).toMatchObject({
      ok: true,
      relativePath: "Scratch/answer.pdf",
    });
  });

  test("a file named like a secret in .eva/scratch is refused, as anywhere else in the vault (#767)", () => {
    write(".eva/scratch/key.pem", "x");
    expect(resolveSendableFile(vault, ".eva/scratch/key.pem")).toMatchObject({
      ok: false,
      reason: ".eva/scratch/key.pem is a secret file, so Eva does not send it.",
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
    expect(first).toMatch(/^\.eva\/scratch\/received\/photo-[0-9a-f]{12}\.jpg$/);
    expect(second).not.toBe(first);
    expect([...readFileSync(join(vault, first))]).toEqual([1, 2, 3]);
  });

  test("a file for a project lands in its own folder, which the daily clean empties too (#768)", () => {
    const saved = saveReceivedFile(vault, "plan.pdf", new Uint8Array([1]), "2025-03-04-1015-house");
    expect(saved).toMatch(/^\.eva\/scratch\/received\/2025-03-04-1015-house\/plan-[0-9a-f]{12}\.pdf$/);
    expect(cleanScratch(vault, new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).toBe(1);
    expect(existsSync(join(vault, saved))).toBe(false);
  });

  test("a hostile name cannot leave the folder", () => {
    const saved = saveReceivedFile(vault, "../../evil name?.sh", new Uint8Array([1]));
    expect(saved).toMatch(/^\.eva\/scratch\/received\/[\w.-]+-[0-9a-f]{12}\.sh$/);
    expect(saved).not.toContain("..");
    expect(existsSync(join(vault, saved))).toBe(true);
    expect(saveReceivedFile(vault, "", new Uint8Array([2]))).toMatch(/^\.eva\/scratch\/received\/file-[0-9a-f]{12}$/);
  });

  test("a name in any language keeps its letters (issue 409)", () => {
    expect(saveReceivedFile(vault, "写真 día.jpg", new Uint8Array([3]))).toMatch(
      /^\.eva\/scratch\/received\/写真-día-[0-9a-f]{12}\.jpg$/,
    );
    expect(saveReceivedFile(vault, "हिन्दी.txt", new Uint8Array([4]))).toMatch(
      /^\.eva\/scratch\/received\/हिन्दी-[0-9a-f]{12}\.txt$/,
    );
  });

  test("a long name in a script of several bytes a letter still fits the file system", () => {
    // Letters of 4 bytes, and an extension of odd length, so a cut by UTF-16 units splits a letter in two.
    const saved = saveReceivedFile(vault, `${"𠀀".repeat(100)}.jpeg`, new Uint8Array([5]));
    expect(saved).toMatch(/^\.eva\/scratch\/received\/(𠀀)+-[0-9a-f]{12}\.jpeg$/u);
    expect(existsSync(join(vault, saved))).toBe(true);
  });

  test("the note tells the agent where a received file is", () => {
    expect(receivedFileNote(".eva/scratch/received/a-1.jpg")).toBe(
      "[The person sent a file, saved as .eva/scratch/received/a-1.jpg]",
    );
  });

  test("files older than a week are removed, newer ones stay", () => {
    write(".eva/scratch/old.pdf", "old");
    write(".eva/scratch/received/new.jpg", "new");
    const now = new Date();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    utimesSync(join(vault, ".eva", "scratch", "old.pdf"), eightDaysAgo, eightDaysAgo);
    expect(cleanScratch(vault, now)).toBe(1);
    expect(existsSync(join(vault, ".eva", "scratch", "old.pdf"))).toBe(false);
    expect(existsSync(join(vault, ".eva", "scratch", "received", "new.jpg"))).toBe(true);
  });

  test("the old Scratch/ empties as its files age, and then goes away (#767)", () => {
    oldVault();
    write("Scratch/old.pdf", "old");
    write("Scratch/received/new.jpg", "new");
    const now = new Date();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60_000);
    utimesSync(join(vault, "Scratch", "old.pdf"), eightDaysAgo, eightDaysAgo);
    expect(cleanScratch(vault, now)).toBe(1);
    expect(existsSync(join(vault, "Scratch", "received", "new.jpg"))).toBe(true);
    const tenDaysLater = new Date(now.getTime() + 10 * 24 * 60 * 60_000);
    expect(cleanScratch(vault, tenDaysLater)).toBe(1);
    expect(existsSync(join(vault, "Scratch"))).toBe(false);
  });

  test("the new .eva/scratch stays when it is empty", () => {
    write(".eva/scratch/old.pdf", "old");
    expect(cleanScratch(vault, new Date(Date.now() + 10 * 24 * 60 * 60_000))).toBe(1);
    expect(existsSync(join(vault, ".eva", "scratch"))).toBe(true);
  });

  test("the clean touches only Eva's own folders, by their exact names", () => {
    oldVault();
    write("scratch/old.pdf", "old");
    write(".eva/Scratch/old.pdf", "old");
    write(".EVA/scratch/old.pdf", "old");
    expect(cleanScratch(vault, new Date(Date.now() + 10 * 24 * 60 * 60_000))).toBe(0);
    expect(existsSync(join(vault, "scratch", "old.pdf"))).toBe(true);
  });

  test("in a new vault, a Scratch/ folder is the person's own, so the clean never touches it", () => {
    write(".gitignore", "Projects/*/repos/\n.eva/scratch/\n");
    write("Scratch/notes.md", "My notes.\n");
    write("Scratch/Empty/.keep", "");
    rmSync(join(vault, "Scratch", "Empty", ".keep"));
    expect(cleanScratch(vault, new Date(Date.now() + 10 * 24 * 60 * 60_000))).toBe(0);
    expect(existsSync(join(vault, "Scratch", "notes.md"))).toBe(true);
    expect(existsSync(join(vault, "Scratch", "Empty"))).toBe(true);
    expect(scratchFolders(vault)).toEqual([]);
  });

  test("the old Scratch/ also loses a week-old link, never its target, and then goes away", () => {
    oldVault();
    const outside = join(folder, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "mine");
    mkdirSync(join(vault, "Scratch"));
    try {
      symlinkSync(join(outside, "keep.txt"), join(vault, "Scratch", "link"), "file");
    } catch {
      return; // A system that cannot make the link has none to remove.
    }
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    lutimesSync(join(vault, "Scratch", "link"), old, old);
    expect(cleanScratch(vault, new Date())).toBe(1);
    expect(readFileSync(join(outside, "keep.txt"), "utf-8")).toBe("mine");
    expect(existsSync(join(vault, "Scratch"))).toBe(false);
  });

  test("a file that goes away during the cleanup is skipped, and the cleanup goes on", () => {
    write(".eva/scratch/a-gone.pdf", "gone");
    write(".eva/scratch/b-old.pdf", "old");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    utimesSync(join(vault, ".eva", "scratch", "b-old.pdf"), eightDaysAgo, eightDaysAgo);
    const real = fs.lstatSync;
    const stat = spyOn(fs, "lstatSync").mockImplementation(((path: string, ...rest: unknown[]) => {
      if (path.endsWith("a-gone.pdf")) throw Object.assign(new Error("ENOENT: gone"), { code: "ENOENT" });
      return (real as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.lstatSync);
    try {
      expect(cleanScratch(vault, new Date())).toBe(1);
    } finally {
      stat.mockRestore();
    }
    expect(existsSync(join(vault, ".eva", "scratch", "b-old.pdf"))).toBe(false);
  });

  test("the new scratch folder comes first, then the old one", () => {
    oldVault();
    write("Scratch/a.pdf", "a");
    write(".eva/scratch/c.pdf", "c");
    expect(scratchFolders(vault)).toEqual([".eva/scratch", "Scratch"]);
  });

  test("a vault without a scratch folder cleans nothing", () => {
    expect(cleanScratch(join(folder, "nowhere"), new Date())).toBe(0);
  });
});

describe("security review", () => {
  test.each([".eva/scratch", "Scratch"])("the cleanup of %s never follows a link out of it", (scratch) => {
    oldVault();
    const outside = join(folder, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "mine");
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    utimesSync(join(outside, "keep.txt"), old, old);
    mkdirSync(join(vault, scratch), { recursive: true });
    try {
      symlinkSync(outside, join(vault, scratch, "link"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    cleanScratch(vault, new Date());
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });

  test("the cleanup never follows a scratch folder that is itself a link", () => {
    oldVault();
    const outside = join(folder, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "mine");
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    utimesSync(join(outside, "keep.txt"), old, old);
    try {
      symlinkSync(outside, join(vault, "Scratch"), "junction");
    } catch {
      return;
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

describe("names that the old list hid (review of #707)", () => {
  test("a plain secret.json and a plain .env stay out of Telegram", () => {
    write("Notes/secret.json", '{"a": 1}');
    write("Notes/.env", "PORT=3000\n");
    expect(resolveSendableFile(vault, "Notes/secret.json")).toMatchObject({ ok: false });
    expect(resolveSendableFile(vault, "Notes/.env")).toMatchObject({ ok: false });
  });
});
