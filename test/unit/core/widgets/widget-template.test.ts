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

function trackedFiles(folder: string): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "--", folder], { cwd: root });
  return result.stdout
    .toString()
    .split("\n")
    .filter((path) => path !== "");
}

function trackedTemplateFiles(): string[] {
  return trackedFiles("templates/widget").map((path) => path.slice("templates/widget/".length));
}

/** The names of the skill folders in `.agents/skills/` among these paths. */
function skillNames(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((path) => /^\.agents\/skills\/([^/]+)\//.exec(path)?.[1] ?? []))].sort();
}

describe("widgetTemplate", () => {
  test("carries every tracked file of templates/widget and of Eva's skills (#983)", () => {
    expect(Object.keys(widgetTemplate(names)).sort()).toEqual(
      [...trackedTemplateFiles(), ...trackedFiles(".agents/skills")].sort(),
    );
  });

  test("carries each skill file of Eva byte for byte, so the setup report finds it up to date (#983)", () => {
    const files = widgetTemplate(names);
    const skills = trackedFiles(".agents/skills");
    expect(skills.length).toBeGreaterThan(0);
    for (const path of skills) expect(files[path]).toBe(readFileSync(join(root, path), "utf8"));
  });

  test("ships each skill that its AGENTS.md names, and names each skill that it ships (#983)", () => {
    const files = widgetTemplate(names);
    const agents = files["AGENTS.md"] ?? "";
    const named = [...new Set([...agents.matchAll(/`\.agents\/skills\/([^/`]+)\/SKILL\.md`/g)].map((m) => m[1] ?? ""))];
    const shipped = skillNames(Object.keys(files));
    expect(named.sort()).toEqual(shipped);
    for (const name of shipped) expect(files[`.agents/skills/${name}/SKILL.md`]).toBeDefined();
    // A skill of Eva with the name of a template skill would replace it.
    const own = skillNames(trackedTemplateFiles());
    expect(skillNames(trackedFiles(".agents/skills")).filter((name) => own.includes(name))).toEqual([]);
  });

  test("keeps the habits of the preview in Life/Habits, a folder of the vault map (#772, #1001)", () => {
    const config = JSON.parse(widgetTemplate(names)["config.json"] ?? "") as { habits: string };
    expect(config.habits).toBe("Life/Habits");
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

  test("adds Eva's skills as they are, and leaves out a git-ignored file of them (#983)", () => {
    const repository = mkdtempSync(join(tmpdir(), "widget-template-"));
    const folder = join(repository, "templates", "widget");
    const skill = join(repository, ".agents", "skills", "demo");
    try {
      writeFileSync(join(repository, ".gitignore"), "*.log\n");
      mkdirSync(folder, { recursive: true });
      mkdirSync(join(skill, "parts"), { recursive: true });
      writeFileSync(join(folder, "index.html"), "<p>hi</p>");
      writeFileSync(join(skill, "SKILL.md"), "---\nname: demo\n---\n# Demo\n");
      writeFileSync(join(skill, "parts", "step.md"), "One step.\n");
      writeFileSync(join(skill, "debug.log"), "");
      const files = readWidgetTemplate(folder, repository);
      expect(Object.keys(files).sort()).toEqual([
        ".agents/skills/demo/SKILL.md",
        ".agents/skills/demo/parts/step.md",
        "index.html",
      ]);
      expect(files[".agents/skills/demo/SKILL.md"]).toBe("---\nname: demo\n---\n# Demo\n");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
