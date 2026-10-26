import { describe, expect, test } from "bun:test";
import {
  childPath,
  fileAddressOf,
  filePathOf,
  isUnder,
  parentOf,
  pathCrumbs,
  sizeWords,
  splitFrontMatter,
  vaultPathOf,
} from "../../../../../src/frontends/web/client/file-paths.ts";

describe("fileAddressOf and filePathOf", () => {
  test("the vault root is #/files", () => {
    expect(fileAddressOf("")).toBe("#/files");
    expect(filePathOf("#/files")).toBe("");
    expect(filePathOf("#/files/")).toBe("");
    expect(filePathOf("#/files/./Projects/.")).toBe("Projects");
    expect(filePathOf("#/files/Projects/../Methods")).toBe("Methods");
    expect(filePathOf("#/files/../..")).toBe("");
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

  test("a path is under itself and under each folder that holds it, never under a name that only starts the same", () => {
    expect(isUnder("Methods", "Methods")).toBe(true);
    expect(isUnder("Methods/Plan.md", "Methods")).toBe(true);
    expect(isUnder("Methods 2/Plan.md", "Methods")).toBe(false);
    expect(isUnder("Library", "Methods")).toBe(false);
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
    [0, "0 B"],
    [999, "999 B"],
    [1_500, "1.5 KB"],
    [2_400_000, "2.4 MB"],
  ])("%p bytes read as %s", (bytes, words) => {
    expect(sizeWords(bytes)).toBe(words);
  });
});

describe("splitFrontMatter", () => {
  test("a note's front matter comes apart from its body", () => {
    expect(splitFrontMatter("---\nstatus: active\n---\n# Example app\n")).toEqual({
      frontMatter: "status: active",
      body: "# Example app\n",
    });
  });

  test("Windows line endings split the same way", () => {
    expect(splitFrontMatter("---\r\nstatus: active\r\n---\r\n# A\r\n")).toEqual({
      frontMatter: "status: active",
      body: "# A\r\n",
    });
  });

  test("an empty front matter comes apart too", () => {
    expect(splitFrontMatter("---\n---\nbody\n")).toEqual({ frontMatter: "", body: "body\n" });
  });

  test("a rule that is not at the start, or never closes, is no front matter", () => {
    expect(splitFrontMatter("# A\n---\nb\n---\n")).toEqual({ frontMatter: null, body: "# A\n---\nb\n---\n" });
    expect(splitFrontMatter("---\nstatus: active\n")).toEqual({ frontMatter: null, body: "---\nstatus: active\n" });
  });
});

describe("vaultPathOf", () => {
  test("a relative path with a slash, or one Markdown note, is a vault path", () => {
    expect(vaultPathOf("Toolbox/Health/Workout Routines.md")).toBe("Toolbox/Health/Workout Routines.md");
    expect(vaultPathOf("Inbox.md")).toBe("Inbox.md");
    expect(vaultPathOf(".eva/skills/schedule/SKILL.md")).toBe(".eva/skills/schedule/SKILL.md");
    expect(vaultPathOf("R&D/plan.md")).toBe("R&D/plan.md");
    expect(vaultPathOf("Books/Dune (1965).md")).toBe("Books/Dune (1965).md");
    expect(vaultPathOf("People/Ana's notes.md")).toBe("People/Ana's notes.md");
  });

  test("a folder loses its last slash, and a leading ./ folds away", () => {
    expect(vaultPathOf("Toolbox/Health/")).toBe("Toolbox/Health");
    expect(vaultPathOf("Toolbox/")).toBe("Toolbox");
    expect(vaultPathOf("./Projects/notes.md")).toBe("Projects/notes.md");
    expect(vaultPathOf(" Toolbox/Health ")).toBe("Toolbox/Health");
  });

  test("code that only looks like a name is no path", () => {
    expect(vaultPathOf("console.log")).toBeNull();
    expect(vaultPathOf("package.json")).toBeNull();
    expect(vaultPathOf("v1.2.3")).toBeNull();
    expect(vaultPathOf("Projects")).toBeNull();
    expect(vaultPathOf("")).toBeNull();
    expect(vaultPathOf("/")).toBeNull();
  });

  test("a command, a URL, an absolute path or a step out of the vault is no path", () => {
    expect(vaultPathOf("cd Toolbox/Health")).toBeNull();
    expect(vaultPathOf("cat >> notes/a.md")).toBeNull();
    expect(vaultPathOf("https://example.com/a.md")).toBeNull();
    expect(vaultPathOf("/srv/vault/a.md")).toBeNull();
    expect(vaultPathOf("~/vault/a.md")).toBeNull();
    expect(vaultPathOf("C:/vault/a.md")).toBeNull();
    expect(vaultPathOf("../secrets/a.md")).toBeNull();
    expect(vaultPathOf("Projects/../../a.md")).toBeNull();
    expect(vaultPathOf("src/*.ts")).toBeNull();
    expect(vaultPathOf("a / b")).toBeNull();
    expect(vaultPathOf("Projects//a.md")).toBeNull();
    expect(vaultPathOf("a/b\\c.md")).toBeNull();
  });
});
