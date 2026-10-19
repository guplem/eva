import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverProjects,
  parseFrontMatter,
  parseProjectQuery,
  searchProjects,
  titleHeading,
} from "../../../../src/core/projects/project-catalog.ts";

let vault: string;

function addProject(id: string, frontMatter: string, body = "\n# Project\n"): void {
  const folder = join(vault, "Projects", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "AGENTS.md"), `---\n${frontMatter}\n---\n${body}`);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-projects-"));
  mkdirSync(join(vault, ".eva"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("parseFrontMatter", () => {
  test("reads the known fields and keeps unknown keys", () => {
    const result = parseFrontMatter(
      "---\ncreated: 2025-03-02T10:15\nstatus: active\nrepos:\n  - https://github.com/owner/app\ntags: [work, tool]\nlegacy_id: P93\ncustom: kept\n---\n# Body\n",
    );
    expect(result.frontMatter).toEqual({
      created: "2025-03-02T10:15",
      status: "active",
      repos: ["https://github.com/owner/app"],
      tags: ["work", "tool"],
      legacyId: "P93",
      extra: { custom: "kept" },
    });
    expect(result.warnings).toEqual([]);
  });

  test("accepts Windows line endings", () => {
    expect(parseFrontMatter("---\r\ncreated: 2025-03-02T10:15\r\nstatus: idea\r\n---\r\n").frontMatter?.status).toBe(
      "idea",
    );
  });

  test("turns a bad field into a warning, never an exception (lesson 54)", () => {
    const result = parseFrontMatter("---\ncreated: 2025-03-02T10:15\nstatus: dreaming\nrepos: nope\n---\n");
    expect(result.frontMatter?.status).toBeNull();
    expect(result.frontMatter?.repos).toEqual([]);
    expect(result.warnings).toEqual(["status must be idea, active, paused or closed", "repos must be a list of URLs"]);
  });

  test("reports a file with no front matter, or broken YAML", () => {
    expect(parseFrontMatter("# Just text\n")).toEqual({ frontMatter: null, warnings: ["no front matter"] });
    expect(parseFrontMatter("---\ncreated: [unclosed\n---\n").warnings[0]).toContain("invalid YAML");
  });

  test("reads a YAML date value as text", () => {
    expect(parseFrontMatter("---\ncreated: 2025-03-02\nstatus: closed\n---\n").frontMatter?.created).toBe("2025-03-02");
  });
});

describe("discoverProjects", () => {
  test("finds every project folder with front matter, and skips other entries", () => {
    addProject("2025-03-02-1015-example-app", "created: 2025-03-02T10:15\nstatus: active");
    addProject("2019-03-old-tool", "created: 2019-03\ncreated_precision: month\nstatus: closed");
    mkdirSync(join(vault, "Projects", "not-a-project"));
    writeFileSync(join(vault, "Projects", "_inventory.csv"), "id\n");
    mkdirSync(join(vault, "Projects", "2025-04-01-0900-no-agents-file"));

    const projects = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(projects.map((project) => project.id).sort()).toEqual(["2019-03-old-tool", "2025-03-02-1015-example-app"]);
    expect(projects.find((project) => project.id === "2019-03-old-tool")?.parsedId.precision).toBe("month");
  });

  test("a fence closes only on the same marker, at least as long", () => {
    for (const body of [
      "```\n~~~\n# in\n```\n# real\n",
      "~~~\n```\n# a\n~~~\n# real\n",
      "````\n```\n# in\n````\n# real\n",
    ]) {
      expect(titleHeading(body)?.title).toBe("real");
    }
    expect(titleHeading("    ```\n# real\n")?.title).toBe("real");
    // A backtick in the info string makes inline code, not a fence.
    expect(titleHeading("```js``` inline\n# real\n")?.title).toBe("real");
  });

  test("the title is the first heading outside a code fence", () => {
    addProject("2025-03-02-1015-example-app", "status: active", "\n```\n# a comment in code\n```\n\n# Real title\n");
    expect(discoverProjects({ vaultPath: vault, extraRoots: [] })[0]?.title).toBe("Real title");
  });

  test("the description is the first paragraph after the title, in one line", () => {
    addProject(
      "2025-03-02-1015-example-app",
      "status: active",
      "\n# Example app\n\nA web app for the\nclient portal.\n\nMore text.\n",
    );
    addProject("2025-03-03-1015-list-first", "status: active", "\n# List first\n\n- not a description\n");
    addProject("2025-03-04-1015-no-body", "status: active");
    addProject("2025-03-05-1015-no-title", "status: active", "\nJust a line.\n");
    const projects = discoverProjects({ vaultPath: vault, extraRoots: [] });
    const description = (id: string): string | null | undefined =>
      projects.find((project) => project.id === id)?.description;
    expect(description("2025-03-02-1015-example-app")).toBe("A web app for the client portal.");
    expect(description("2025-03-03-1015-list-first")).toBeNull();
    expect(description("2025-03-04-1015-no-body")).toBeNull();
    expect(description("2025-03-05-1015-no-title")).toBe("Just a line.");
  });

  test("names the clone folders of each project", () => {
    addProject("2025-03-02-1015-example-app", "status: active");
    mkdirSync(join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "example-app-0"), { recursive: true });
    mkdirSync(join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "example-app-1"), { recursive: true });
    mkdirSync(join(vault, "Projects", "2025-03-02-1015-example-app", "repos", "notes"), { recursive: true });
    addProject("2025-03-03-1015-empty", "status: idea");
    const projects = discoverProjects({ vaultPath: vault, extraRoots: [] });
    expect(projects.find((project) => project.id === "2025-03-02-1015-example-app")?.clones).toEqual([
      "example-app-0",
      "example-app-1",
    ]);
    expect(projects.find((project) => project.id === "2025-03-03-1015-empty")?.clones).toEqual([]);
  });

  test("warns when the front matter time does not match the folder name", () => {
    addProject("2025-03-02-1015-example-app", "created: 2025-03-03T10:15\nstatus: active");
    expect(discoverProjects({ vaultPath: vault, extraRoots: [] })[0]?.warnings).toEqual([
      "created 2025-03-03T10:15 does not match the folder name",
    ]);
  });

  test("also reads extra project roots", () => {
    const extra = join(vault, "elsewhere");
    mkdirSync(join(extra, "2026-01-01-0000-outside"), { recursive: true });
    writeFileSync(
      join(extra, "2026-01-01-0000-outside", "AGENTS.md"),
      "---\ncreated: 2026-01-01T00:00\nstatus: idea\n---\n",
    );
    expect(discoverProjects({ vaultPath: vault, extraRoots: [extra] }).map((project) => project.id)).toEqual([
      "2026-01-01-0000-outside",
    ]);
  });

  test("a vault with no Projects folder has no projects", () => {
    expect(discoverProjects({ vaultPath: vault, extraRoots: [join(vault, "missing")] })).toEqual([]);
  });
});

describe("searchProjects", () => {
  test("filters by words, status and tag, most recent first", () => {
    addProject(
      "2024-01-01-0900-photo-sorter",
      "created: 2024-01-01T09:00\nstatus: closed\ntags: [hobby]",
      "\n# Photo sorter\n",
    );
    addProject(
      "2026-05-01-0900-photo-booth",
      "created: 2026-05-01T09:00\nstatus: active\ntags: [hobby]",
      "\n# Booth\n",
    );
    addProject("2025-02-01-0900-tax-report", "created: 2025-02-01T09:00\nstatus: active\ntags: [life]", "\n# Taxes\n");
    const projects = discoverProjects({ vaultPath: vault, extraRoots: [] });

    expect(searchProjects(projects, {}).map((project) => project.id)).toEqual([
      "2026-05-01-0900-photo-booth",
      "2025-02-01-0900-tax-report",
      "2024-01-01-0900-photo-sorter",
    ]);
    expect(searchProjects(projects, { text: "PHOTO" }).map((project) => project.id)).toEqual([
      "2026-05-01-0900-photo-booth",
      "2024-01-01-0900-photo-sorter",
    ]);
    expect(searchProjects(projects, { status: "active", tag: "hobby" }).map((project) => project.id)).toEqual([
      "2026-05-01-0900-photo-booth",
    ]);
  });

  test("the words also match the tags, and the tag filter ignores case", () => {
    addProject("2025-02-01-0900-tax-report", "created: 2025-02-01T09:00\nstatus: active\ntags: [Life]", "\n# Taxes\n");
    addProject("2026-05-01-0900-photo-booth", "created: 2026-05-01T09:00\nstatus: active\ntags: [hobby]");
    const projects = discoverProjects({ vaultPath: vault, extraRoots: [] });

    expect(searchProjects(projects, { text: "life" }).map((project) => project.id)).toEqual([
      "2025-02-01-0900-tax-report",
    ]);
    expect(searchProjects(projects, { tag: "LIFE" }).map((project) => project.id)).toEqual([
      "2025-02-01-0900-tax-report",
    ]);
  });
});

describe("parseProjectQuery", () => {
  test("reads the status and tag words, and keeps the rest as text", () => {
    expect(parseProjectQuery("photo status:Active #hobby booth")).toEqual({
      text: "photo booth",
      status: "active",
      tag: "hobby",
    });
    expect(parseProjectQuery("tag:life")).toEqual({ text: "", tag: "life" });
    // One tag filters. A second tag word still searches, because the words also match the tags.
    expect(parseProjectQuery("#life #money")).toEqual({ text: "money", tag: "life" });
    expect(parseProjectQuery("tag: #")).toEqual({ text: "tag: #" });
  });

  test("status:any removes the status filter, and an unknown status stays a search word", () => {
    expect(parseProjectQuery("status:any taxes")).toEqual({ text: "taxes" });
    expect(parseProjectQuery("status:dreaming")).toEqual({ text: "status:dreaming" });
    expect(parseProjectQuery("  ")).toEqual({ text: "" });
  });
});
