import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRepositoryFacts, type GithubAnswer } from "../../../../src/core/projects/repository-facts.ts";
import type { GithubWrite } from "../../../../src/core/projects/repository-fixes.ts";
import type { SetupItem, SetupReport } from "../../../../src/core/projects/repository-setup.ts";
import { repositoryTypeOf } from "../../../../src/core/projects/repository-types.ts";
import {
  describeWidgetRequest,
  pushWidgetTemplate,
  startFirstDeploy,
  widgetProjectNote,
} from "../../../../src/core/widgets/widget-setup.ts";
import { widgetTemplate } from "../../../../src/core/widgets/widget-template.ts";
import { evaRepository } from "../../../../src/shared/version.ts";
import { fakeGithub, type FakeRepository } from "../../../support/fake-github.ts";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const slug = "you/habits-widget";
const labels = ["auto-developing", "requires-human-intervention", "waiting-for-human-check"];

/** Eva's own files that the report compares with: her skills, her rules, her hooks and her CI. */
function evaFiles(): Record<string, string> {
  const listed = Bun.spawnSync(["git", "ls-files", ".agents/skills", ".github/workflows"], { cwd: root })
    .stdout.toString()
    .split("\n")
    .filter((path) => path !== "");
  const paths = [...listed, "AGENTS.md", "lefthook.yml", "package.json", ".claude/settings.json"];
  return Object.fromEntries(paths.map((path) => [path, readFileSync(`${root}/${path}`, "utf8")]));
}

/** Every answer of a repository where each setting and each security feature is on. */
const allOn = {
  "rules/branches/main": [{ type: "required_status_checks" }],
  "private-vulnerability-reporting": { enabled: true },
  "automated-security-fixes": { enabled: true },
  "code-scanning/default-setup": { state: "configured" },
  "actions/permissions/workflow": { default_workflow_permissions: "read" },
  languages: { JavaScript: 1000 },
  pages: { build_type: "workflow" },
};

function widgetReport(target: FakeRepository): Promise<SetupReport> {
  const fake = fakeGithub({ [evaRepository]: { files: evaFiles(), labels }, [slug]: target });
  const type = repositoryTypeOf("widget");
  if (type === null) throw new Error("no widget type");
  return Promise.all([readRepositoryFacts(slug, fake), readRepositoryFacts(evaRepository, fake)]).then(
    ([facts, reference]) => type.report(facts, reference),
  );
}

function items(report: SetupReport): SetupItem[] {
  return report.sections.flatMap((section) => section.items);
}

function item(report: SetupReport, label: string): SetupItem | undefined {
  return items(report).find((entry) => entry.label === label);
}

/** The template as Eva pushes it, with Eva's skills that the direct fix copies. */
function setUpWidget(): Record<string, string> {
  const skills = Object.fromEntries(Object.entries(evaFiles()).filter(([path]) => path.startsWith(".agents/skills/")));
  return { ...widgetTemplate({ owner: "you", repository: "habits-widget", title: "Habits" }), ...skills };
}

describe("the widget report", () => {
  test("a repository from the template, after the direct fixes, is green, except the items that only a person can do", async () => {
    const report = await widgetReport({
      repository: {
        allow_auto_merge: true,
        allow_update_branch: true,
        delete_branch_on_merge: true,
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "enabled" },
        },
      },
      files: setUpWidget(),
      labels,
      answers: allOn,
      security: { hasVulnerabilityAlertsEnabled: true, isSecurityPolicyEnabled: true },
    });
    expect(report.type).toBe("widget");
    const notGreen = items(report).filter((entry) => entry.light !== "green");
    expect(notGreen.map((entry) => [entry.label, entry.light, entry.detail])).toEqual([
      ["Malware alerts", "grey", "GitHub has no API for this. Check it on the settings page."],
    ]);
    expect(report.sections.map((section) => section.title)).toContain("Widget");
  });

  test("a new widget repository gets a direct fix for each setting, with the ruleset after the commit of the skills", async () => {
    const report = await widgetReport({
      files: widgetTemplate({ owner: "you", repository: "habits-widget", title: "Habits" }),
      labels: ["bug"],
      answers: { "rules/branches/main": [], "branches/main": { protected: false } },
    });
    expect(item(report, "GitHub Pages")).toMatchObject({
      light: "red",
      directFix: { kind: "api", method: "POST", path: `repos/${slug}/pages`, body: { build_type: "workflow" } },
    });
    const ruleset = item(report, "Required checks before merge");
    expect(ruleset).toMatchObject({
      light: "red",
      directFix: { method: "POST", path: `repos/${slug}/rulesets`, last: true },
    });
    expect(JSON.stringify(ruleset?.directFix)).toContain('"context":"lint"');
    expect(JSON.stringify(ruleset?.directFix)).toContain('"context":"test"');
    expect(item(report, "Widget manifest")?.light).toBe("green");
    expect(item(report, "Data schemas")?.light).toBe("green");
    expect(item(report, "Widget check in CI")?.light).toBe("green");
    expect(item(report, "Test that the widget fills the screen")?.light).toBe("green");
  });

  test("a repository whose CI has other check names gets no ruleset fix, which would block each pull request", async () => {
    const files = setUpWidget();
    files[".github/workflows/ci.yml"] = (files[".github/workflows/ci.yml"] ?? "").replace("  lint:\n", "  build:\n");
    const report = await widgetReport({
      files,
      labels,
      answers: { "rules/branches/main": [], "branches/main": { protected: false } },
    });
    const ruleset = item(report, "Required checks before merge");
    expect(ruleset?.light).toBe("red");
    expect(ruleset?.directFix).toBeUndefined();
  });

  test("a schema with a field loc or my_field fails, with the name that fails", async () => {
    const files = setUpWidget();
    const schema = JSON.parse(files["schemas/habits.json"] ?? "") as { properties: Record<string, unknown> };
    schema.properties["loc"] = { type: "string" };
    schema.properties["my_field"] = { type: "string" };
    const report = await widgetReport({ files: { ...files, "schemas/habits.json": JSON.stringify(schema) }, labels });
    const schemas = item(report, "Data schemas");
    expect(schemas?.light).toBe("red");
    expect(schemas?.detail).toContain('"loc"');
    expect(schemas?.detail).toContain('"my_field"');
    expect(schemas?.fixRequest).toContain("docs/widgets.md");
  });

  test("a manifest of a newer contract is grey and asks for an update of Eva; a broken one is red", async () => {
    const report = await widgetReport({ files: { ...setUpWidget(), "eva-widget.json": '{"contract": 9}' }, labels });
    expect(item(report, "Widget manifest")).toMatchObject({
      light: "grey",
      detail: "This widget follows contract 9. Update Eva to use this widget.",
      fixRequest: null,
    });
    expect(item(report, "Data schemas")?.light).toBe("grey");
    const broken = await widgetReport({ files: { ...setUpWidget(), "eva-widget.json": '{"contract": 1}' }, labels });
    expect(item(broken, "Widget manifest")?.light).toBe("red");
    expect(item(broken, "Widget manifest")?.fixRequest).toContain("docs/widgets.md");
    expect(item(broken, "Data schemas")?.light).toBe("grey");
  });

  test("a repository with no widget files has red widget items, each with a request for a chat", async () => {
    const report = await widgetReport({ files: { "README.md": "# Habits\n" }, labels });
    for (const label of ["Widget manifest", "Widget check in CI", "Test that the widget fills the screen"]) {
      expect(item(report, label)).toMatchObject({ light: "red", fixRequest: expect.stringContaining(slug) as string });
    }
  });

  test("on a private repository, Pages off and the ruleset show grey, with the reason", async () => {
    const report = await widgetReport({
      repository: { private: true },
      files: setUpWidget(),
      labels,
      answers: { "rules/branches/main": [], "branches/main": { protected: false } },
    });
    expect(item(report, "GitHub Pages")).toMatchObject({
      light: "grey",
      detail: expect.stringContaining("paid plan") as string,
    });
    expect(item(report, "Required checks before merge")?.light).toBe("grey");
  });

  test("Pages from a branch, or with no deploy workflow, is yellow", async () => {
    const fromBranch = await widgetReport({
      files: setUpWidget(),
      labels,
      answers: { pages: { build_type: "legacy" } },
    });
    expect(item(fromBranch, "GitHub Pages")).toMatchObject({ light: "yellow", directFix: { method: "PUT" } });
    const files = setUpWidget();
    delete files[".github/workflows/pages.yml"];
    const noDeploy = await widgetReport({ files, labels, answers: { pages: { build_type: "workflow" } } });
    expect(item(noDeploy, "GitHub Pages")?.light).toBe("yellow");
  });
});

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function recorder(answers: Readonly<Record<string, GithubAnswer | GithubAnswer[]>>): {
  write: GithubWrite;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queues = new Map(
    Object.entries(answers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]),
  );
  const write: GithubWrite = (method, path, body) => {
    calls.push({ method, path, body });
    const queue = queues.get(`${method} ${path}`);
    const answer = queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0];
    return Promise.resolve(answer ?? { status: 200, body: "{}" });
  };
  return { write, calls };
}

const ok = (body: unknown): GithubAnswer => ({ status: 200, body: JSON.stringify(body) });

describe("the widget setup steps", () => {
  test("the template is one commit on top of GitHub's first commit, with the names of the repository", async () => {
    const { write, calls } = recorder({
      [`GET repos/${slug}`]: ok({ default_branch: "main" }),
      // GitHub makes the first commit a moment late.
      [`GET repos/${slug}/git/ref/heads/main`]: [
        { status: 409, body: '{"message":"Git Repository is empty."}' },
        ok({ object: { sha: "first" } }),
      ],
      [`GET repos/${slug}/git/commits/first`]: ok({ tree: { sha: "base" } }),
      [`POST repos/${slug}/git/trees`]: ok({ sha: "tree" }),
      [`POST repos/${slug}/git/commits`]: ok({ sha: "commit" }),
    });
    const waits: number[] = [];
    await pushWidgetTemplate(slug, write, "Habits", (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    });
    expect(waits).toEqual([1_000]);
    const tree = calls.find((call) => call.path.endsWith("/git/trees"))?.body as {
      base_tree: string;
      tree: { path: string; content: string }[];
    };
    expect(tree.base_tree).toBe("base");
    const readme = tree.tree.find((entry) => entry.path === "README.md");
    expect(readme?.content).toContain("https://you.github.io/habits-widget/");
    expect(tree.tree.map((entry) => entry.path)).toContain(".github/workflows/ci.yml");
    expect(calls.find((call) => call.path.endsWith("/git/commits"))?.body).toEqual({
      message: "feat: start the widget from Eva's template",
      tree: "tree",
      parents: ["first"],
    });
    expect(calls.at(-1)).toEqual({
      method: "PATCH",
      path: `repos/${slug}/git/refs/heads/main`,
      body: { sha: "commit" },
    });
  });

  test("a repository with no first commit fails after a few tries, with GitHub's reason", async () => {
    const { write } = recorder({
      [`GET repos/${slug}/git/ref/heads/main`]: { status: 409, body: '{"message":"Git Repository is empty."}' },
    });
    const failure = await pushWidgetTemplate(slug, write, "Habits", () => Promise.resolve()).catch(
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("Git Repository is empty.");
  });

  test("the first deploy starts the Pages workflow on the default branch", async () => {
    const { write, calls } = recorder({ [`GET repos/${slug}`]: ok({ default_branch: "trunk" }) });
    await startFirstDeploy(slug, write);
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: `repos/${slug}/actions/workflows/pages.yml/dispatches`,
      body: { ref: "trunk" },
    });
  });

  test("with Pages off, Eva starts no deploy, which would only fail", async () => {
    const { write, calls } = recorder({ [`GET repos/${slug}/pages`]: { status: 404, body: "{}" } });
    await startFirstDeploy(slug, write);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET repos/${slug}/pages`]);
  });

  test("the first chat asks the person to describe the widget, after the rules of the repository", () => {
    const request = describeWidgetRequest(slug);
    expect(request).toContain("`habits-widget/AGENTS.md`");
    expect(request).toContain("ask the person what the widget must do");
    expect(request).toContain("docs/widgets.md");
  });

  test("the project note names the rules of the repository in the clone", () => {
    expect(widgetProjectNote("https://github.com/you/habits-widget.git")).toContain("`habits-widget/AGENTS.md`");
  });
});
