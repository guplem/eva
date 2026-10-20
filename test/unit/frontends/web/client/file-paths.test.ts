import { describe, expect, test } from "bun:test";
import {
  childPath,
  fileAddressOf,
  filePathOf,
  isMarkdown,
  parentOf,
  pathCrumbs,
  sizeWords,
} from "../../../../../src/frontends/web/client/file-paths.ts";

describe("fileAddressOf and filePathOf", () => {
  test("the vault root is #/files", () => {
    expect(fileAddressOf("")).toBe("#/files");
    expect(filePathOf("#/files")).toBe("");
    expect(filePathOf("#/files/")).toBe("");
  });

  test("a path keeps its slashes, and each part is encoded", () => {
    const address = fileAddressOf("Projects/2025 notes/a#b.md");
    expect(address).toBe("#/files/Projects/2025%20notes/a%23b.md");
    expect(filePathOf(address)).toBe("Projects/2025 notes/a#b.md");
  });

  test("another address has no file path", () => {
    expect(filePathOf("#/chats")).toBeNull();
    expect(filePathOf("#/filesx")).toBeNull();
  });

  test("a bad escape opens the vault root instead of a crash", () => {
    expect(filePathOf("#/files/%E0")).toBe("");
  });
});

describe("path parts", () => {
  test("the crumbs lead from the vault to the path", () => {
    expect(pathCrumbs("")).toEqual([{ name: "Vault", path: "" }]);
    expect(pathCrumbs("Methods/Plan.md")).toEqual([
      { name: "Vault", path: "" },
      { name: "Methods", path: "Methods" },
      { name: "Plan.md", path: "Methods/Plan.md" },
    ]);
  });

  test("the parent of a path, and of the root", () => {
    expect(parentOf("Methods/Plan.md")).toBe("Methods");
    expect(parentOf("Methods")).toBe("");
    expect(parentOf("")).toBeNull();
  });

  test("a child path joins with a slash, and the root adds none", () => {
    expect(childPath("", "Methods")).toBe("Methods");
    expect(childPath("Methods", "Plan.md")).toBe("Methods/Plan.md");
  });
});

describe("file words", () => {
  test.each([
    ["Plan.md", true],
    ["README.MARKDOWN", true],
    ["main.py", false],
    ["md", false],
  ])("%s is Markdown: %p", (path, expected) => {
    expect(isMarkdown(path)).toBe(expected);
  });

  test.each([
    [0, "0 B"],
    [999, "999 B"],
    [1_500, "1.5 KB"],
    [2_400_000, "2.4 MB"],
  ])("%p bytes read as %s", (bytes, words) => {
    expect(sizeWords(bytes)).toBe(words);
  });
});
