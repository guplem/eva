import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  isProtectedInArea,
  wallRefusal,
  wallRefusesCall,
  wallRefusesPath,
  wallRefusesPattern,
} from "../../../src/shared/path-area.ts";

let root: string;
let area: string;
let outside: string;

/** Inside: the wall that closes the whole test folder lets the path or the pattern through. */
function isInsideArea(folder: string, requested: string, cwd: string): boolean {
  return !wallRefusesPath({ area: folder, closed: [root] }, requested, cwd);
}
function isPatternInsideArea(folder: string, pattern: string, cwd: string): boolean {
  return !wallRefusesPattern({ area: folder, closed: [root] }, pattern, cwd);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-area-"));
  area = join(root, "repos", "clone-0");
  outside = join(root, "Notes");
  mkdirSync(join(area, "src"), { recursive: true });
  mkdirSync(join(root, "repos", "clone-01"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(area, "src", "a.ts"), "");
  writeFileSync(join(outside, "plan.md"), "");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A link that a system without the right cannot make, such as Windows with no developer mode, skips its test. */
function link(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, "junction");
    return true;
  } catch {
    return false;
  }
}

describe("isInsideArea (#711)", () => {
  test("a path in the area, the area itself, and a relative path from the start folder are inside", () => {
    expect(isInsideArea(area, join(area, "src", "a.ts"), area)).toBe(true);
    expect(isInsideArea(area, area, area)).toBe(true);
    expect(isInsideArea(area, "src/a.ts", area)).toBe(true);
    expect(isInsideArea(area, "../clone-0/src/a.ts", join(area, "src"))).toBe(true);
  });

  test("a path that leaves the area, a sibling whose name starts the same, and the vault are outside", () => {
    expect(isInsideArea(area, "../../Notes/plan.md", area)).toBe(false);
    expect(isInsideArea(area, join(outside, "plan.md"), area)).toBe(false);
    expect(isInsideArea(area, join(root, "repos", "clone-01"), area)).toBe(false);
    expect(isInsideArea(area, root, area)).toBe(false);
  });

  test("a new file is checked by its nearest folder that exists", () => {
    expect(isInsideArea(area, join(area, "new", "deep", "f.ts"), area)).toBe(true);
    expect(isInsideArea(area, join(outside, "new", "f.md"), area)).toBe(false);
  });

  test("a link inside the area that points out is outside, for a file that exists and for a new one", () => {
    if (!link(outside, join(area, "notes"))) return;
    expect(isInsideArea(area, join(area, "notes", "plan.md"), area)).toBe(false);
    expect(isInsideArea(area, join(area, "notes", "new.md"), area)).toBe(false);
  });

  test("a link that points inside the area stays inside", () => {
    if (!link(join(area, "src"), join(area, "source"))) return;
    expect(isInsideArea(area, join(area, "source", "a.ts"), area)).toBe(true);
  });

  test("an area that does not exist holds nothing", () => {
    expect(isInsideArea(join(root, "gone"), join(root, "gone", "a.ts"), area)).toBe(false);
  });

  test.skipIf(process.platform !== "win32")(
    "on Windows, case, separators and a file stream do not open a way out",
    () => {
      expect(isInsideArea(area, area.toUpperCase().replaceAll("\\", "/") + "/SRC/A.TS", area)).toBe(true);
      expect(isInsideArea(area, join(area, "src", "a.ts:stream"), area)).toBe(false);
      expect(isInsideArea(area, `\\\\?\\${join(outside, "plan.md")}`, area)).toBe(false);
    },
  );
});

describe("isPatternInsideArea (#711)", () => {
  test("a pattern from the start folder stays inside", () => {
    expect(isPatternInsideArea(area, "src/**/*.ts", area)).toBe(true);
    expect(isPatternInsideArea(area, "**/*.md", area)).toBe(true);
  });

  test("a pattern that climbs or starts outside the area is outside", () => {
    expect(isPatternInsideArea(area, "../**", area)).toBe(false);
    expect(isPatternInsideArea(area, "src/../../**/*", area)).toBe(false);
    expect(isPatternInsideArea(area, "{src,../x}/*", area)).toBe(false);
    expect(isPatternInsideArea(area, join(outside, "*.md"), area)).toBe(false);
  });

  test("an absolute pattern inside the area is inside", () => {
    expect(isPatternInsideArea(area, join(area, "src", "*.ts"), area)).toBe(true);
  });
});

describe("isInsideArea, after the review of #711", () => {
  test("a `..` after a link goes up from the link's target, as the system does", () => {
    mkdirSync(join(outside, "deep"), { recursive: true });
    writeFileSync(join(outside, "secret.md"), "");
    if (!link(join(outside, "deep"), join(area, "link"))) return;
    expect(isInsideArea(area, "link/../secret.md", area)).toBe(false);
    expect(isInsideArea(area, "src/../link/../secret.md", area)).toBe(false);
  });

  test("a `..` after a part that does not exist, or after a dangling link, is refused", () => {
    expect(isInsideArea(area, "gone/../src/a.ts", area)).toBe(false);
    try {
      symlinkSync(join(outside, "nothing", "here"), join(area, "dang"));
    } catch {
      return;
    }
    expect(isInsideArea(area, "dang/../x", area)).toBe(false);
  });

  test("a path that only the tool can read, such as `file://`, is refused", () => {
    expect(isInsideArea(area, `file://${join(outside, "plan.md")}`, area)).toBe(false);
  });
});

describe("isPatternInsideArea, after the review of #711", () => {
  test("a `..` that a brace, an extglob or a character class builds is refused", () => {
    expect(isPatternInsideArea(area, ".{.,}/out/*", area)).toBe(false);
    expect(isPatternInsideArea(area, "{.,x}{.,y}/out/*", area)).toBe(false);
    expect(isPatternInsideArea(area, "+(.)/out/*", area)).toBe(false);
    expect(isPatternInsideArea(area, "@(..)/x", area)).toBe(false);
    expect(isPatternInsideArea(area, "[.][.]/x", area)).toBe(false);
  });

  test("the common patterns of a project still pass", () => {
    expect(isPatternInsideArea(area, "**/*.{ts,tsx}", area)).toBe(true);
    expect(isPatternInsideArea(area, "src/*.[jt]s", area)).toBe(true);
    expect(isPatternInsideArea(area, ".github/**/*.yml", area)).toBe(true);
  });
});

describe("isPatternInsideArea braces (#711)", () => {
  test("nested braces and a brace with no comma are read as a glob reads them", () => {
    expect(isPatternInsideArea(area, "src/{a,{b,c}}.ts", area)).toBe(true);
    expect(isPatternInsideArea(area, "src/{a,{b,../../../c}}.ts", area)).toBe(false);
    expect(isPatternInsideArea(area, "src/{x}/*.ts", area)).toBe(true);
    expect(isPatternInsideArea(area, "{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}{o,p}{q,r}/*", area)).toBe(false);
  });
});

describe("the wall: what a Project chat may not open (review of #711)", () => {
  const wall = (): { area: string; closed: string[] } => ({ area, closed: [root] });

  test("refuses the closed folders and each folder that holds one, and nothing else", () => {
    expect(wallRefusesPath(wall(), join(outside, "plan.md"), area)).toBe(true);
    expect(wallRefusesPath(wall(), "../../Notes/plan.md", area)).toBe(true);
    // A search from a folder above the vault would reach into it.
    expect(wallRefusesPath(wall(), join(root, ".."), area)).toBe(true);
    expect(wallRefusesPath(wall(), "/", area)).toBe(true);
    // The chat's own folder, and the files of the machine, stay open.
    expect(wallRefusesPath(wall(), "src/a.ts", area)).toBe(false);
    expect(wallRefusesPath(wall(), join(tmpdir(), "x.txt"), area)).toBe(false);
  });

  test("reads `~` as the home folder, as both engines do, and keeps a `$` in a name as plain text", () => {
    const home = { area, closed: [homedir()] };
    expect(wallRefusesPath(home, "~/x", area)).toBe(true);
    expect(wallRefusesPath(home, "~", area)).toBe(true);
    expect(wallRefusesPattern(home, "~/notes/*", area)).toBe(true);
    expect(wallRefusesPath(wall(), "~/x", area)).toBe(false);
    expect(wallRefusesPath(wall(), "~other/x", area)).toBe(true);
    // A route file such as `$id.tsx` is a common name. No file tool expands `$HOME`.
    expect(wallRefusesPath(wall(), "src/$id.tsx", area)).toBe(false);
    expect(wallRefusesPath(wall(), "$HOME/x", area)).toBe(false);
  });

  test.skipIf(process.platform !== "win32")(
    "on Windows, a variable and a path from a drive's own folder are refused",
    () => {
      expect(wallRefusesPath(wall(), "%USERPROFILE%\\x", area)).toBe(true);
      expect(wallRefusesPath(wall(), "C:x", area)).toBe(true);
    },
  );

  test("a leading `@` is a name for Claude Code and a prefix for pi, and each engine checks what it opens", () => {
    if (!link(outside, join(area, "@v"))) return;
    const options = { patternKeys: [], write: false };
    expect(wallRefusesCall(wall(), area, { file_path: "@v/plan.md" }, { ...options, dropsAt: false })).toBe(true);
    expect(wallRefusesCall(wall(), area, { path: `@${join(outside, "plan.md")}` }, { ...options, dropsAt: true })).toBe(
      true,
    );
    expect(wallRefusesCall(wall(), area, { path: "@src/a.ts" }, { ...options, dropsAt: true })).toBe(false);
  });

  test("a pattern refuses a search from a folder that holds the vault", () => {
    expect(wallRefusesPattern(wall(), join(root, "..", "**", "*.md"), area)).toBe(true);
    expect(wallRefusesPattern(wall(), "../**", area)).toBe(true);
    expect(wallRefusesPattern(wall(), "src/*/../../../x", area)).toBe(true);
    expect(wallRefusesPattern(wall(), "/*", area)).toBe(true);
    expect(wallRefusesPattern(wall(), "/**/AGENTS.md", area)).toBe(true);
    expect(wallRefusesPattern(wall(), "**/*.{ts,tsx}", area)).toBe(false);
    const other = mkdtempSync(join(tmpdir(), "eva-other-"));
    try {
      expect(wallRefusesPattern(wall(), join(other, "*.log"), area)).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("a write to the folder's own settings, its MCP servers or a git folder is refused", () => {
    expect(isProtectedInArea(area, ".claude/settings.local.json", area)).toBe(true);
    expect(isProtectedInArea(area, ".mcp.json", area)).toBe(true);
    expect(isProtectedInArea(area, ".pi/extensions/x.ts", area)).toBe(true);
    expect(isProtectedInArea(area, "example-app/.git/config", area)).toBe(true);
    expect(isProtectedInArea(area, "example-app/.git/hooks/pre-commit", area)).toBe(true);
    // A repository's own settings are the repository's content: Claude Code reads only the start folder's.
    expect(isProtectedInArea(area, "example-app/.claude/settings.json", area)).toBe(false);
    expect(isProtectedInArea(area, "src/a.ts", area)).toBe(false);
  });
});

describe("the wall's read-only folders (#774)", () => {
  let project: string;
  let clone: string;
  /** A chat in a clone: the vault closed, its project folder read-only, the other clones closed. */
  const wall = (): { area: string; closed: string[]; readOnly: string[] } => ({
    area: clone,
    closed: [root, join(project, "repos")],
    readOnly: [project],
  });
  const read = { patternKeys: ["pattern"], write: false, reads: true, dropsAt: false };
  const write = { ...read, write: true, reads: false };
  // A tool that Eva does not know, such as an MCP tool, may write: it opens no read-only folder.
  const unknown = { ...read, reads: false };
  const list = { ...read, lists: true };

  beforeEach(() => {
    project = join(root, "Projects", "2026-01-01-0900-example-app");
    clone = join(project, "repos", "clone-0");
    mkdirSync(join(clone, "example-app"), { recursive: true });
    mkdirSync(join(project, "repos", "clone-1", "example-app"), { recursive: true });
    mkdirSync(join(project, "decisions"), { recursive: true });
    writeFileSync(join(project, "plan.md"), "");
    writeFileSync(join(project, "repos", "AGENTS.md"), "");
  });

  test("a read in the read-only folder passes, by a relative or an absolute path, dot files too", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: "../../plan.md" }, read)).toBe(false);
    expect(wallRefusesCall(wall(), clone, { file_path: join(project, ".secrets") }, read)).toBe(false);
    expect(wallRefusesCall(wall(), clone, { path: "../../decisions", pattern: "*.md" }, read)).toBe(false);
  });

  test("a write in the read-only folder is refused, and a write in the area passes", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: "../../plan.md" }, write)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: join(project, "new.md") }, write)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: "example-app/a.ts" }, write)).toBe(false);
  });

  test("a closed folder inside the read-only one stays closed, and so does a search that holds it", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: "../clone-1/example-app/a.ts" }, read)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: "../AGENTS.md" }, read)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { path: "../.." }, read)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { pattern: "../../**/*.ts" }, read)).toBe(true);
  });

  test("the rest of the vault stays closed", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: join(outside, "plan.md") }, read)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: "../../../x.md" }, read)).toBe(true);
  });

  test("a read-only folder opens any folder, such as one beside the area", () => {
    const received = { area: clone, closed: [root], readOnly: [outside] };
    expect(wallRefusesCall(received, clone, { file_path: join(outside, "plan.md") }, read)).toBe(false);
    expect(wallRefusesCall(received, clone, { file_path: join(outside, "plan.md") }, write)).toBe(true);
    expect(wallRefusesCall(received, clone, { file_path: "../../plan.md" }, read)).toBe(true);
  });

  test("only a tool that Eva knows as a read opens the read-only folder", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: "../../plan.md" }, unknown)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: "example-app/a.ts" }, unknown)).toBe(false);
  });

  test("a link or a climb that leads into another clone is refused, and so is a clone that does not exist yet", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: "../../decisions/../repos/clone-1/x" }, read)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: "../clone-9/x" }, read)).toBe(true);
    if (link(join(project, "repos", "clone-1"), join(project, "other"))) {
      expect(wallRefusesCall(wall(), clone, { file_path: "../../other/example-app/a.ts" }, read)).toBe(true);
      expect(wallRefusesCall(wall(), clone, { path: "../../other" }, list)).toBe(true);
    }
  });

  test("a link in the clone that leads to a note reads it, but a write through it is refused", () => {
    if (!link(join(project, "decisions"), join(clone, "notes"))) return;
    expect(wallRefusesCall(wall(), clone, { file_path: "notes/a.md" }, read)).toBe(false);
    expect(wallRefusesCall(wall(), clone, { file_path: "notes/a.md" }, write)).toBe(true);
  });

  test.skipIf(process.platform === "linux")("on a system that ignores case, `REPOS/` is `repos/`", () => {
    expect(wallRefusesCall(wall(), clone, { file_path: "../../REPOS/clone-1/x" }, read)).toBe(true);
  });

  test("a listing of the project folder passes, and a search of it is refused as a search", () => {
    expect(wallRefusesCall(wall(), clone, { path: "../.." }, list)).toBe(false);
    expect(wallRefusesCall(wall(), clone, { pattern: "../../*.md" }, list)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { path: "../..", pattern: "*.{md,txt}" }, list)).toBe(true);
    // Claude Code's Glob runs `rg --files --glob`, so even `*.md` matches at any depth: no Glob is a listing.
    expect(wallRefusesCall(wall(), clone, { pattern: join(project, "*.md") }, read)).toBe(true);
    expect(wallRefusal(wall(), clone, { pattern: join(project, "*.md") }, read)).toBe("search");
    expect(wallRefusesCall(wall(), clone, { pattern: "../../**/*.md" }, list)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { path: "../..", pattern: "**/*.md" }, list)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { path: "../..", pattern: "*/*.md" }, list)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { file_path: project }, read)).toBe(true);
    expect(wallRefusal(wall(), clone, { path: "../.." }, read)).toBe("search");
    expect(wallRefusal(wall(), clone, { file_path: "../clone-1/x" }, read)).toBe("outside");
    // A listing never opens a closed folder itself, or a folder above the read-only one.
    expect(wallRefusesCall(wall(), clone, { path: ".." }, list)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { path: root }, list)).toBe(true);
  });

  test("a pattern starts at the call's own path, not at the start folder", () => {
    expect(wallRefusesCall(wall(), clone, { path: "../../decisions", pattern: "../repos/clone-1/*" }, read)).toBe(true);
    expect(wallRefusesCall(wall(), clone, { path: "../../decisions", pattern: "*.md" }, read)).toBe(false);
  });
});
