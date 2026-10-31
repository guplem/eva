import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxSearchMatches, searchVault } from "../../../../src/core/files/vault-search.ts";

let folder: string;
let vault: string;
const keep = (text: string): string => text;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-search-"));
  vault = join(folder, "vault");
  write("Methods/Plan.md", "# Plan\nCall the dentist on Monday.\n");
  write("Methods/Meeting plan.txt", "Nothing here.\n");
  write("notes.txt", "Buy milk.\nPLAN the trip.\n");
  write(".git/plan", "[core]\n");
  write(".env", "PLAN=secret\n");
  write("picture.png", new Uint8Array([0x89, 0x50, 0x00, 0x00, 0x70, 0x6c, 0x61, 0x6e]));
  write("Projects/2025-03-02-1015-example-app/AGENTS.md", "---\ncreated: 2025-03-02T10:15\n---\n# Garden planner\n");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(relativePath: string, content: string | Uint8Array): void {
  const path = join(vault, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("searchVault: names", () => {
  test("finds files and folders by a part of the name, in any case, never in .git", () => {
    const result = searchVault(vault, "plan", { contents: false }, keep);
    expect(result.complete).toBe(true);
    // The project title "Garden planner" holds the query too.
    expect(result.matches.map((match) => match.path)).toEqual([
      "Methods/Meeting plan.txt",
      "Methods/Plan.md",
      "Projects/2025-03-02-1015-example-app",
    ]);
    expect(result.matches[0]).toEqual({ path: "Methods/Meeting plan.txt", name: "Meeting plan.txt", kind: "file" });
  });

  test("finds a project folder by its title", () => {
    const result = searchVault(vault, "garden", { contents: false }, keep);
    expect(result.matches).toEqual([
      {
        path: "Projects/2025-03-02-1015-example-app",
        name: "2025-03-02-1015-example-app",
        kind: "folder",
        title: "Garden planner",
      },
    ]);
  });

  test("an empty query finds nothing", () => {
    expect(searchVault(vault, "   ", { contents: true }, keep).matches).toEqual([]);
  });

  test("never follows a link", () => {
    write("outside/plan-notes.md", "x");
    symlinkSync(join(vault, "outside"), join(vault, "linked"), "dir");
    const result = searchVault(vault, "plan-notes", { contents: false }, keep);
    expect(result.matches.map((match) => match.path)).toEqual(["outside/plan-notes.md"]);
  });
});

describe("searchVault: files to share with a chat in a clone (#706)", () => {
  test("never walks into a clone and lists no secret file", () => {
    write("Projects/2025-03-02-1015-example-app/repos/clone-0/example-app/plan.md", "Code.\n");
    write("Projects/2025-03-02-1015-example-app/.env.planning", "TOKEN=1\n");
    const all = searchVault(vault, "plan", { contents: false }, keep).matches.map((match) => match.path);
    expect(all).toContain("Projects/2025-03-02-1015-example-app/repos/clone-0/example-app/plan.md");
    const shareable = searchVault(vault, "plan", { contents: false, shareable: true }, keep).matches.map(
      (match) => match.path,
    );
    expect(shareable).toContain("Methods/Plan.md");
    expect(shareable.some((path) => path.includes("/repos/"))).toBe(false);
    expect(all).toContain("Projects/2025-03-02-1015-example-app/.env.planning");
    expect(shareable).not.toContain("Projects/2025-03-02-1015-example-app/.env.planning");
  });
});

describe("searchVault: contents", () => {
  test("also finds the text inside a file, with the first line that holds it", () => {
    const result = searchVault(vault, "plan", { contents: true }, keep);
    const lines = result.matches.filter((match) => match.line !== undefined);
    expect(lines).toEqual([
      { path: "notes.txt", name: "notes.txt", kind: "file", line: { number: 2, text: "PLAN the trip." } },
      {
        path: "Projects/2025-03-02-1015-example-app/AGENTS.md",
        name: "AGENTS.md",
        kind: "file",
        line: { number: 4, text: "# Garden planner" },
      },
    ]);
    // A name match keeps no line, a secrets file and a binary file show nothing.
    expect(result.matches.some((match) => match.path === ".env" || match.path === "picture.png")).toBe(false);
    expect(result.matches.find((match) => match.path === "Methods/Plan.md")?.line).toBeUndefined();
  });

  test("redacts the shown line", () => {
    write("token.md", "the key is ghp_abc\n");
    const result = searchVault(vault, "key", { contents: true }, (text) => text.replace("ghp_abc", "[hidden]"));
    expect(result.matches[0]?.line?.text).toBe("the key is [hidden]");
  });

  test("cuts a long line around the match", () => {
    write("long.md", `${"a".repeat(500)} needle ${"b".repeat(500)}\n`);
    const text = searchVault(vault, "needle", { contents: true }, keep).matches[0]?.line?.text ?? "";
    expect(text).toContain("needle");
    expect(text.length).toBeLessThan(200);
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
  });

  test("stops at the match limit and says so", () => {
    for (let index = 0; index <= maxSearchMatches; index += 1) write(`many/note-${String(index)}.md`, "x");
    const result = searchVault(vault, "note-", { contents: false }, keep);
    expect(result.matches).toHaveLength(maxSearchMatches);
    expect(result.complete).toBe(false);
  });
});

describe("searchVault: the vault's secret files (#707)", () => {
  test("never reads the text of a listed or an encrypted file, and lists neither to share", () => {
    write(".eva/secret-files", "Private/**\n");
    write("Private/keys.md", "the zebra key\n");
    write(
      "Notes/copy.md",
      "Encrypted by Eva. Open this file in Eva's Files page to read it.\neva-encrypted-v1 0123456789abcdef\nAAAA\n",
    );
    expect(searchVault(vault, "zebra", { contents: true }, keep).matches).toEqual([]);
    expect(searchVault(vault, "aaaa", { contents: true }, keep).matches).toEqual([]);
    const shareable = searchVault(vault, "md", { contents: false, shareable: true }, keep).matches;
    expect(shareable.map((match) => match.path)).not.toContain("Private/keys.md");
    expect(shareable.map((match) => match.path)).not.toContain("Notes/copy.md");
  });
});
