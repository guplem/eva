import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBacklinks } from "../../../../src/core/files/vault-backlinks.ts";
import { maxSearchMatches } from "../../../../src/core/files/vault-search.ts";

let folder: string;
let vault: string;
const keep = (text: string): string => text;
const target = "Principles/Small steps.md";

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-backlinks-"));
  vault = join(folder, "vault");
  write(target, "# Small steps\nSee [[Weekly review]].\n");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const path = join(vault, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

const pathsOf = (path = target): string[] =>
  findBacklinks(vault, path, keep)
    .links.map((link) => link.path)
    .sort();

describe("findBacklinks: wiki links", () => {
  test("finds a link by the name, in any case, with an alias, a heading or an embed", () => {
    write("Methods/Weekly review.md", "# Weekly review\nPick one of the [[Small steps]] for the week.\n");
    write("Life/Journal/a.md", "Tried [[small STEPS|the idea]] again.\n");
    write("Life/Journal/b.md", "Read [[Small steps#Why]].\n");
    write("Life/Journal/c.md", "![[Principles/Small steps]]\n");
    write("Life/Journal/d.md", "Read [[Small steps.md]].\n");
    expect(pathsOf()).toEqual([
      "Life/Journal/a.md",
      "Life/Journal/b.md",
      "Life/Journal/c.md",
      "Life/Journal/d.md",
      "Methods/Weekly review.md",
    ]);
  });

  test("gives the name and the first line that holds the link", () => {
    write("Methods/Weekly review.md", "# Weekly review\nPick one of the [[Small steps]] for the week.\n");
    expect(findBacklinks(vault, target, keep)).toEqual({
      links: [
        {
          path: "Methods/Weekly review.md",
          name: "Weekly review.md",
          line: { number: 2, text: "Pick one of the [[Small steps]] for the week." },
        },
      ],
      complete: true,
    });
  });

  test("never matches another file with a longer name, another folder, or the file itself", () => {
    write("a.md", "[[Small steps 2]] [[Other/Small steps]] [[steps]] [[#Small steps]]\n");
    expect(pathsOf()).toEqual([]);
  });

  test("finds a link to a file that is not a note", () => {
    write("Library/photo.png", "x");
    write("a.md", "![[photo.png]]\n");
    expect(pathsOf("Library/photo.png")).toEqual(["a.md"]);
  });
});

describe("findBacklinks: Markdown links", () => {
  test("resolves a relative, an encoded, a root and an angle link", () => {
    write("Methods/a.md", "Follow [small steps](../Principles/Small%20steps.md#why).\n");
    write("Principles/b.md", 'See [it](Small%20steps.md "title").\n');
    write("c.md", "See [it](/Principles/Small%20steps.md).\n");
    write("d.md", "See [it](<Principles/Small steps.md>).\n");
    expect(pathsOf()).toEqual(["Methods/a.md", "Principles/b.md", "c.md", "d.md"]);
  });

  test("never matches a web link, a link that leaves the vault, or a link from another folder", () => {
    write("a.md", "[web](https://example.com/Principles/Small%20steps.md)\n");
    write("Methods/b.md", "[x](Small%20steps.md) [y](../../Principles/Small%20steps.md)\n");
    expect(pathsOf()).toEqual([]);
  });
});

describe("findBacklinks: what Eva never reads", () => {
  test("skips the clones, secret files, encrypted files and files that are not Markdown", () => {
    write("Projects/2025-03-02-1015-example-app/repos/clone-1/app/README.md", "[[Small steps]]\n");
    write(".eva/secret-files", "Private/**\n");
    write("Private/keys.md", "[[Small steps]]\n");
    write(
      "Notes/copy.md",
      "Encrypted by Eva. Open this file in Eva's Files page to read it.\neva-encrypted-v1 0123456789abcdef\n[[Small steps]]\n",
    );
    write("notes.txt", "[[Small steps]]\n");
    write("Projects/2025-03-02-1015-example-app/notes.md", "[[Small steps]]\n");
    expect(pathsOf()).toEqual(["Projects/2025-03-02-1015-example-app/notes.md"]);
  });

  test("redacts the shown line", () => {
    write("a.md", "token abc [[Small steps]]\n");
    const result = findBacklinks(vault, target, (text) => text.replace("abc", "[REDACTED]"));
    expect(result.links[0]?.line.text).toBe("token [REDACTED] [[Small steps]]");
  });

  test("stops at the limit", () => {
    for (let index = 0; index < maxSearchMatches + 5; index += 1)
      write(`Notes/n${String(index).padStart(3, "0")}.md`, "[[Small steps]]\n");
    const result = findBacklinks(vault, target, keep);
    expect(result.links).toHaveLength(maxSearchMatches);
    expect(result.complete).toBe(false);
  });

  test("an empty or missing target has no links", () => {
    write("a.md", "[[Small steps]]\n");
    expect(pathsOf("")).toEqual([]);
    expect(pathsOf("../outside.md")).toEqual([]);
  });
});
