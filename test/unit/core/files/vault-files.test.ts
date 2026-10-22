import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  extractFileMarkers,
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

describe("extractFileMarkers (lesson 124)", () => {
  test("removes marker lines and lists their paths; any case, spaces allowed", () => {
    const markers = extractFileMarkers("Here it is.\n[[attach: Methods/Plan.md]]\n[[OFFER:Methods/Other.md ]]\nBye.");
    expect(markers).toEqual({ text: "Here it is.\nBye.", attach: ["Methods/Plan.md"], offer: ["Methods/Other.md"] });
  });

  test("a marker inside a sentence or a code fence stays text", () => {
    const answer = "Write [[attach: a.md]] like this:\n```\n[[attach: b.md]]\n```";
    expect(extractFileMarkers(answer)).toEqual({ text: answer, attach: [], offer: [] });
  });

  test("a file named twice goes once, and attach wins over offer", () => {
    const markers = extractFileMarkers("[[offer: a.md]]\n[[attach: a.md]]\n[[attach: a.md]]\n[[offer: b.md]]");
    expect(markers).toEqual({ text: "", attach: ["a.md"], offer: ["b.md"] });
  });
});

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
    ["Projects/2025-03-02-1015-example-app/.env", "secrets file"],
    ["Projects/2025-03-02-1015-example-app/server.pem", "secrets file"],
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
