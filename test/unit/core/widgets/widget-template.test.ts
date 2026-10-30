import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkWidget } from "../../../../src/core/widgets/widget-contract.ts";
import { readWidgetTemplate } from "../../../../src/core/widgets/widget-template-files.ts";
import { widgetTemplate } from "../../../../src/core/widgets/widget-template.ts";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const names = { owner: "Example-User", repository: "habits-widget", title: 'Tom & "Jerry" <habits>' };

function trackedTemplateFiles(): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "templates/widget"], { cwd: root });
  return result.stdout
    .toString()
    .split("\n")
    .filter((path) => path !== "")
    .map((path) => path.slice("templates/widget/".length))
    .sort();
}

describe("widgetTemplate", () => {
  test("carries every tracked file of templates/widget", () => {
    expect(Object.keys(widgetTemplate(names)).sort()).toEqual(trackedTemplateFiles());
  });

  test("puts the names of the new repository in place of the example names", () => {
    const files = widgetTemplate(names);
    expect(files["README.md"]).toContain("https://example-user.github.io/habits-widget/");
    expect(files["README.md"]).toContain("https://github.com/Example-User/habits-widget");
    expect(files["README.md"]).toContain('# Tom & "Jerry" <habits>');
    expect(files["index.html"]).toContain("<title>Tom &amp; &quot;Jerry&quot; &lt;habits&gt;</title>");
    expect((JSON.parse(files["eva-widget.json"] ?? "") as { name: string }).name).toBe('Tom & "Jerry" <habits>');
    expect((JSON.parse(files["package.json"] ?? "") as { name: string }).name).toBe("habits-widget");
    expect(Object.values(files).some((text) => /example-(?:owner|widget)|Example widget/.test(text))).toBe(false);
  });

  test("keeps a dollar sign of a title, and cuts a long title to the manifest's limit", () => {
    const files = widgetTemplate({ ...names, title: `Price $& watch $$ ${"x".repeat(80)}` });
    expect(files["README.md"]).toContain("# Price $& watch $$ x");
    const manifest = JSON.parse(files["eva-widget.json"] ?? "") as { name: string };
    expect(manifest.name).toHaveLength(60);
    expect(manifest.name).toStartWith("Price $& watch $$ x");
    expect(checkWidget((path) => files[path] ?? null).manifest).toEqual([]);
  });

  test("follows the widget contract", () => {
    const files = widgetTemplate(names);
    expect(checkWidget((path) => files[path] ?? null)).toEqual({ manifest: [], schemas: [] });
  });

  test("uses the habits format of the example in docs/widgets.md", () => {
    const docs = readFileSync(`${root}/docs/widgets.md`, "utf8");
    const example = /`schemas\/habits\.json`:\n\n```json\n([\s\S]*?)\n```/.exec(docs)?.[1];
    expect(JSON.parse(example ?? "null")).toEqual(JSON.parse(widgetTemplate(names)["schemas/habits.json"] ?? ""));
  });
});

describe("readWidgetTemplate", () => {
  test("leaves out each file that a .gitignore of the template or of Eva names, at its level and below", () => {
    const repository = mkdtempSync(join(tmpdir(), "widget-template-"));
    const folder = join(repository, "templates", "widget");
    try {
      writeFileSync(join(repository, ".gitignore"), "node_modules/\n*.log\n.claude/skills/\n");
      mkdirSync(join(folder, ".pskill", "runs"), { recursive: true });
      mkdirSync(join(folder, "node_modules", "x"), { recursive: true });
      writeFileSync(join(folder, ".gitignore"), "# local files\n.env\n.env.*\n");
      writeFileSync(join(folder, ".env"), "TOKEN=x");
      writeFileSync(join(folder, ".env.local"), "TOKEN=x");
      writeFileSync(join(folder, "index.html"), "<p>hi</p>");
      writeFileSync(join(folder, "node_modules", "x", "index.js"), "");
      writeFileSync(join(folder, ".pskill", ".gitignore"), "runs/\n");
      writeFileSync(join(folder, ".pskill", "runs", "run.json"), "{}");
      writeFileSync(join(folder, ".pskill", "config.yaml"), "stub_folders: []\n");
      writeFileSync(join(folder, "npm-debug.log"), "");
      expect(Object.keys(readWidgetTemplate(folder, repository)).sort()).toEqual([
        ".gitignore",
        ".pskill/.gitignore",
        ".pskill/config.yaml",
        "index.html",
      ]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
