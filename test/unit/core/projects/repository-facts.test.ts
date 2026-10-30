import { describe, expect, test } from "bun:test";
import {
  ghApiRequest,
  readRepositoryFacts,
  type GithubAnswer,
} from "../../../../src/core/projects/repository-facts.ts";
import { EvaError, isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

const slug = "owner/example-app";

function ok(body: unknown): GithubAnswer {
  return { status: 200, body: JSON.stringify(body) };
}

const workflow =
  "name: checks\non:\n  pull_request:\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: |\n          npm ci\n          npm run check\n";
const codeql = "on: push\njobs:\n  analyze:\n    steps:\n      - uses: github/codeql-action/analyze@v3\n";

/** The answers of a repository with every feature on, by API path. */
function fullAnswers(): Map<string, GithubAnswer> {
  return new Map<string, GithubAnswer>([
    [
      `repos/${slug}`,
      ok({
        default_branch: "main",
        private: false,
        permissions: { admin: true },
        allow_auto_merge: true,
        allow_update_branch: false,
        delete_branch_on_merge: true,
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "disabled" },
        },
      }),
    ],
    [
      `repos/${slug}/git/trees/main?recursive=1`,
      ok({
        truncated: false,
        tree: [
          { path: "AGENTS.md", type: "blob", sha: "a1" },
          { path: ".github", type: "tree", sha: "t1" },
          { path: ".github/workflows/checks.yml", type: "blob", sha: "w1" },
          { path: ".github/workflows/codeql.yaml", type: "blob", sha: "w2" },
          { path: ".claude/settings.json", type: "blob", sha: "s1" },
        ],
      }),
    ],
    [`repos/${slug}/labels?per_page=100&page=1`, ok([{ name: "bug" }, { name: "owner" }])],
    [`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, { status: 200, body: workflow }],
    [`raw:repos/${slug}/contents/.github/workflows/codeql.yaml?ref=main`, { status: 200, body: codeql }],
    [
      `raw:repos/${slug}/contents/.claude/settings.json?ref=main`,
      { status: 200, body: JSON.stringify({ permissions: { allow: ["Read", 7, "Bash(git log*)"] } }) },
    ],
    [`repos/${slug}/rules/branches/main`, ok([{ type: "deletion" }, { type: "required_status_checks" }])],
    [`repos/${slug}/branches/main`, ok({ protected: false })],
    [`repos/${slug}/private-vulnerability-reporting`, ok({ enabled: true })],
    ["graphql", ok({ data: { repository: { hasVulnerabilityAlertsEnabled: true, isSecurityPolicyEnabled: false } } })],
    [`repos/${slug}/automated-security-fixes`, ok({ enabled: false })],
    [`repos/${slug}/code-scanning/default-setup`, ok({ state: "not-configured" })],
    [`repos/${slug}/actions/permissions/workflow`, ok({ default_workflow_permissions: "read" })],
    [`repos/${slug}/languages`, ok({ TypeScript: 1200 })],
  ]);
}

function fakeGet(answers: Map<string, GithubAnswer>, asked: string[] = []) {
  return (path: string, raw = false, fields: Readonly<Record<string, string>> = {}): Promise<GithubAnswer> => {
    const key = raw ? `raw:${path}` : path;
    asked.push(key);
    // The GraphQL query names the repository in its variables, never in its text.
    if (path === "graphql" && `${fields["owner"] ?? ""}/${fields["name"] ?? ""}` !== slug) {
      return Promise.resolve({ status: 200, body: '{"data":{"repository":null}}' });
    }
    return Promise.resolve(answers.get(key) ?? { status: 404, body: '{"message":"Not Found"}' });
  };
}

describe("readRepositoryFacts", () => {
  test("turns GitHub's answers into facts", async () => {
    const facts = await readRepositoryFacts(slug, fakeGet(fullAnswers()));
    expect(facts).toMatchObject({
      slug,
      defaultBranch: "main",
      isPrivate: false,
      isAdmin: true,
      allowAutoMerge: true,
      allowUpdateBranch: false,
      deleteBranchOnMerge: true,
      labels: ["bug", "owner"],
      allowRules: ["Read", "Bash(git log*)"],
      requiredChecks: true,
      privateVulnerabilityReporting: true,
      dependabotAlerts: true,
      securityPolicy: false,
      dependabotSecurityUpdates: false,
      secretScanning: true,
      pushProtection: false,
      codeScanningDefaultSetup: false,
      readOnlyWorkflowToken: true,
      hasCode: true,
    });
    expect(facts.files).toEqual({
      "AGENTS.md": "a1",
      ".github/workflows/checks.yml": "w1",
      ".github/workflows/codeql.yaml": "w2",
      ".claude/settings.json": "s1",
    });
    expect(facts.workflows).toEqual([
      {
        path: ".github/workflows/checks.yml",
        runsOnPullRequest: true,
        usesCodeql: false,
        commands: ["actions/checkout@v4", "npm ci\nnpm run check\n"],
        jobs: ["checks"],
      },
      {
        path: ".github/workflows/codeql.yaml",
        runsOnPullRequest: false,
        usesCodeql: true,
        commands: ["github/codeql-action/analyze@v3"],
        jobs: ["analyze"],
      },
    ]);
    expect(facts.scripts).toEqual({});
    expect(facts.hooks).toEqual({ commit: [], push: [] });
  });

  test("an admin-only answer that GitHub refuses is null; GraphQL still reads the alerts without admin rights", async () => {
    const answers = fullAnswers();
    const forbidden: GithubAnswer = { status: 403, body: '{"message":"Must have admin rights"}' };
    answers.set(`repos/${slug}`, ok({ default_branch: "main", private: false, permissions: { admin: false } }));
    answers.set(`repos/${slug}/code-scanning/default-setup`, forbidden);
    answers.set(`repos/${slug}/actions/permissions/workflow`, forbidden);
    answers.set(`repos/${slug}/languages`, ok({}));
    answers.delete(`repos/${slug}/rules/branches/main`);
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts).toMatchObject({
      isAdmin: false,
      allowAutoMerge: null,
      secretScanning: null,
      codeScanningDefaultSetup: null,
      readOnlyWorkflowToken: null,
      dependabotAlerts: true,
      requiredChecks: null,
      hasCode: false,
    });
  });

  test("branch protection with checks counts as required checks", async () => {
    const answers = fullAnswers();
    answers.set(`repos/${slug}/rules/branches/main`, ok([]));
    answers.set(
      `repos/${slug}/branches/main`,
      ok({
        protected: true,
        protection: { required_status_checks: { enforcement_level: "everyone", contexts: ["ci"] } },
      }),
    );
    expect((await readRepositoryFacts(slug, fakeGet(answers))).requiredChecks).toBe(true);
  });

  test("a truncated tree gives no file facts, and reads no workflow", async () => {
    const answers = fullAnswers();
    answers.set(`repos/${slug}/git/trees/main?recursive=1`, ok({ truncated: true, tree: [] }));
    const asked: string[] = [];
    const facts = await readRepositoryFacts(slug, fakeGet(answers, asked));
    expect(facts.files).toBeNull();
    expect(facts.workflows).toBeNull();
    expect(asked.filter((path) => path.startsWith("raw:"))).toEqual([
      `raw:repos/${slug}/contents/.claude/settings.json?ref=main`,
    ]);
  });

  test("a settings file that is not JSON has no allow list, and a broken workflow does not run on pull requests", async () => {
    const answers = fullAnswers();
    answers.set(`raw:repos/${slug}/contents/.claude/settings.json?ref=main`, { status: 200, body: "{ not json" });
    answers.set(`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, { status: 200, body: "on: [" });
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.allowRules).toBe("none");
    expect(facts.workflows?.[0]?.runsOnPullRequest).toBe(false);
  });

  test("a job's check name is its plain name, or its key when the name holds an expression", async () => {
    const answers = fullAnswers();
    answers.set(`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, {
      status: 200,
      body: "on: pull_request\njobs:\n  lint:\n    name: Lint the code\n    steps: []\n  test:\n    name: test ${{ matrix.os }}\n    steps: []\n",
    });
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.workflows?.[0]?.jobs).toEqual(["Lint the code", "test"]);
  });

  test("the list form and the string form of `on` both count", async () => {
    const answers = fullAnswers();
    answers.set(`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, {
      status: 200,
      body: "on: [push, pull_request]\n",
    });
    answers.set(`raw:repos/${slug}/contents/.github/workflows/codeql.yaml?ref=main`, {
      status: 200,
      body: "on: pull_request\n",
    });
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.workflows?.map((entry) => entry.runsOnPullRequest)).toEqual([true, true]);
  });

  test("a repository that GitHub does not show is an error with a clear message", async () => {
    const error = await failure(readRepositoryFacts(slug, fakeGet(new Map())));
    expect(isEvaError(error, "github_failed")).toBe(true);
    expect(String(error)).toContain(`GitHub does not show ${slug}`);
  });
});

describe("ghApiRequest", () => {
  test("reads the HTTP status and the body from gh's --include output", async () => {
    const commands: (readonly string[])[] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        commands.push(command);
        return Promise.resolve({
          exitCode: 1,
          stdout: 'HTTP/2.0 404 Not Found\r\nContent-Type: application/json\r\n\r\n{"message":"Not Found"}',
          stderr: "gh: Not Found (HTTP 404)",
        });
      },
    };
    const get = ghApiRequest(runner, { PATH: "x" });
    expect(await get("repos/a/b")).toEqual({ status: 404, body: '{"message":"Not Found"}' });
    await get("repos/a/b/contents/x", true);
    expect(commands[0]).toEqual(["gh", "api", "--include", "repos/a/b"]);
    expect(commands[1]).toEqual([
      "gh",
      "api",
      "--include",
      "-H",
      "Accept: application/vnd.github.raw",
      "repos/a/b/contents/x",
    ]);
  });

  test("gh that does not start, or answers with no status, is an error that names gh", async () => {
    const failing: ProcessRunner = { run: () => Promise.reject(new Error("spawn gh ENOENT")) };
    expect(String(await failure(ghApiRequest(failing, {})("repos/a/b")))).toContain("press Log in with GitHub");
    const loggedOut: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 4,
          stdout: "",
          stderr: "To get started with GitHub CLI, please run: gh auth login",
        }),
    };
    expect(String(await failure(ghApiRequest(loggedOut, {})("repos/a/b")))).toContain("please run: gh auth login");
  });
});

function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => new Error("no failure"),
    (error: unknown) => error,
  );
}

describe("readRepositoryFacts, scripts and git hooks", () => {
  function withFiles(files: Readonly<Record<string, string>>): Map<string, GithubAnswer> {
    const answers = fullAnswers();
    const tree = Object.keys(files).map((path) => ({ path, type: "blob", sha: path }));
    answers.set(`repos/${slug}/git/trees/main?recursive=1`, ok({ truncated: false, tree }));
    for (const [path, text] of Object.entries(files)) {
      answers.set(`raw:repos/${slug}/contents/${path}?ref=main`, { status: 200, body: text });
    }
    return answers;
  }

  test("reads the package scripts, and the commands of Lefthook, Husky and pre-commit", async () => {
    const lefthook = [
      "pre-commit:",
      "  commands:",
      "    lint:",
      "      run: npx eslint {staged_files}",
      "  jobs:",
      "    - run: npx prettier --check {staged_files}",
      "    - script: lint.sh",
      "pre-push:",
      "  commands:",
      "    check:",
      "      run: npm run check",
      "post-merge:",
      "  commands:",
      "    install:",
      "      run: npm install",
    ].join("\n");
    const preCommit = [
      "default_stages: [pre-commit]",
      "repos:",
      "  - repo: https://github.com/astral-sh/ruff-pre-commit",
      "    hooks:",
      "      - id: ruff",
      "      - id: tests",
      "        entry: pytest",
      "        stages: [pre-push]",
    ].join("\n");
    const facts = await readRepositoryFacts(
      slug,
      fakeGet(
        withFiles({
          "package.json": JSON.stringify({ scripts: { check: "eslint .", broken: 7 } }),
          "lefthook.yml": lefthook,
          ".husky/pre-push": "#!/bin/sh\nnpm test\n",
          ".husky/_/husky.sh": "echo helper",
          ".pre-commit-config.yaml": preCommit,
        }),
      ),
    );
    expect(facts.scripts).toEqual({ check: "eslint ." });
    expect(facts.hooks).toEqual({
      commit: ["ruff", "npx eslint {staged_files}", "npx prettier --check {staged_files}", "lint.sh"],
      push: ["#!/bin/sh\nnpm test\n", "pytest", "npm run check"],
    });
  });

  test("a hook file or a package.json that GitHub does not serve is unknown", async () => {
    const answers = withFiles({ "package.json": "{}", ".husky/pre-commit": "npx lint-staged" });
    answers.set(`raw:repos/${slug}/contents/.husky/pre-commit?ref=main`, { status: 502, body: "" });
    answers.set(`raw:repos/${slug}/contents/package.json?ref=main`, { status: 502, body: "" });
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.hooks).toBeNull();
    expect(facts.scripts).toBeNull();
    answers.set(`raw:repos/${slug}/contents/package.json?ref=main`, { status: 404, body: "" });
    expect((await readRepositoryFacts(slug, fakeGet(answers))).scripts).toBeNull();
  });

  test("a broken package.json has no scripts; a hook config that Eva cannot parse is unknown", async () => {
    const facts = await readRepositoryFacts(
      slug,
      fakeGet(withFiles({ "package.json": "{ not json", "lefthook.yml": "pre-commit: [" })),
    );
    expect(facts.scripts).toEqual({});
    expect(facts.hooks).toBeNull();
    const toml = await readRepositoryFacts(slug, fakeGet(withFiles({ "lefthook.toml": '[pre-push]\nrun = "x"' })));
    expect(toml.hooks).toBeNull();
  });

  test("old pre-commit stage names count, and a hook with no stages runs before a commit", async () => {
    const config = [
      "repos:",
      "  - hooks:",
      "      - id: black",
      "      - id: mypy",
      "        stages: [push]",
      "      - id: flake8",
      "        stages: [commit, push]",
    ].join("\n");
    const facts = await readRepositoryFacts(slug, fakeGet(withFiles({ ".pre-commit-config.yaml": config })));
    expect(facts.hooks).toEqual({ commit: ["black", "flake8"], push: ["mypy", "flake8"] });
  });

  test("a job that calls a workflow of the same repository runs that workflow's steps", async () => {
    const caller = "on: pull_request\njobs:\n  checks:\n    uses: ./.github/workflows/shared.yml\n";
    const shared = "on: workflow_call\njobs:\n  lint:\n    steps:\n      - run: npx eslint .\n";
    const facts = await readRepositoryFacts(
      slug,
      fakeGet(withFiles({ ".github/workflows/ci.yml": caller, ".github/workflows/shared.yml": shared })),
    );
    expect(facts.workflows?.[0]).toMatchObject({ runsOnPullRequest: true, commands: ["npx eslint ."] });
  });
});

describe("readRepositoryFacts, failed reads", () => {
  test("a file that GitHub does not serve is unknown, not missing", async () => {
    const answers = fullAnswers();
    const failure: GithubAnswer = { status: 502, body: "" };
    answers.set(`raw:repos/${slug}/contents/.claude/settings.json?ref=main`, failure);
    answers.set(`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, failure);
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.allowRules).toBeNull();
    expect(facts.workflows).toBeNull();
  });

  test("labels are read page by page, and a failed page makes them unknown", async () => {
    const answers = fullAnswers();
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ name: `label-${String(index)}` }));
    answers.set(`repos/${slug}/labels?per_page=100&page=1`, ok(fullPage));
    answers.set(`repos/${slug}/labels?per_page=100&page=2`, ok([{ name: "owner" }]));
    expect((await readRepositoryFacts(slug, fakeGet(answers))).labels).toContain("owner");
    answers.delete(`repos/${slug}/labels?per_page=100&page=2`);
    expect((await readRepositoryFacts(slug, fakeGet(answers))).labels).toBeNull();
  });

  test("an archived repository says so, and a refused repository names the HTTP status", async () => {
    const answers = fullAnswers();
    answers.set(`repos/${slug}`, ok({ default_branch: "main", archived: true }));
    expect((await readRepositoryFacts(slug, fakeGet(answers))).isArchived).toBe(true);
    answers.set(`repos/${slug}`, { status: 403, body: '{"message":"rate limit"}' });
    expect(String(await failure(readRepositoryFacts(slug, fakeGet(answers))))).toContain("HTTP 403");
  });

  test("a gh call that times out says that GitHub was slow, not that gh is missing", async () => {
    const slow: ProcessRunner = { run: () => Promise.reject(new EvaError("process_timeout", "timed out")) };
    expect(String(await failure(ghApiRequest(slow, {})("repos/a/b")))).toContain("did not answer in time");
  });
});

describe("readRepositoryFacts, GraphQL", () => {
  test("a GraphQL answer with errors leaves both facts unknown", async () => {
    const answers = fullAnswers();
    answers.set("graphql", { status: 200, body: '{"data":{"repository":null},"errors":[{"type":"NOT_FOUND"}]}' });
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.dependabotAlerts).toBeNull();
    expect(facts.securityPolicy).toBeNull();
  });

  test("gh sends GraphQL fields with -f, which makes the request a POST", async () => {
    const commands: (readonly string[])[] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        commands.push(command);
        return Promise.resolve({ exitCode: 0, stdout: "HTTP/2.0 200 OK\r\n\r\n{}", stderr: "" });
      },
    };
    await ghApiRequest(runner, {})("graphql", false, { query: "{ viewer { login } }", owner: "a" });
    expect(commands[0]).toEqual([
      "gh",
      "api",
      "--include",
      "graphql",
      "-f",
      "query={ viewer { login } }",
      "-f",
      "owner=a",
    ]);
  });
});

describe("readRepositoryFacts, widgets", () => {
  const manifest = JSON.stringify({
    contract: 1,
    name: "Habits",
    size: "medium",
    inputs: [
      { id: "habits", schema: "schemas/habits.json" },
      { id: "outside", schema: "../secret.json" },
    ],
  });

  function widgetAnswers(): Map<string, GithubAnswer> {
    const answers = fullAnswers();
    const tree = ["eva-widget.json", "schemas/habits.json", "schemas/other.json"].map((path) => ({
      path,
      type: "blob",
      sha: path,
    }));
    answers.set(`repos/${slug}/git/trees/main?recursive=1`, ok({ truncated: false, tree }));
    answers.set(`raw:repos/${slug}/contents/eva-widget.json?ref=main`, { status: 200, body: manifest });
    answers.set(`raw:repos/${slug}/contents/schemas/habits.json?ref=main`, { status: 200, body: '{"type":"object"}' });
    answers.set(`repos/${slug}/pages`, ok({ build_type: "workflow" }));
    return answers;
  }

  test("reads the manifest and each schema that it names, and how GitHub Pages builds", async () => {
    const facts = await readRepositoryFacts(slug, fakeGet(widgetAnswers()));
    expect(facts.widgetFiles).toEqual({ "eva-widget.json": manifest, "schemas/habits.json": '{"type":"object"}' });
    expect(facts.pages).toBe("workflow");
  });

  test("a repository with no manifest has no widget files, and Pages off is off", async () => {
    const facts = await readRepositoryFacts(slug, fakeGet(fullAnswers()));
    expect(facts.widgetFiles).toEqual({});
    expect(facts.pages).toBe("off");
  });

  test("Pages from a branch is a branch build; a refused Pages answer is unknown", async () => {
    const answers = widgetAnswers();
    answers.set(`repos/${slug}/pages`, ok({ build_type: "legacy" }));
    expect((await readRepositoryFacts(slug, fakeGet(answers))).pages).toBe("branch");
    answers.set(`repos/${slug}/pages`, { status: 403, body: "{}" });
    expect((await readRepositoryFacts(slug, fakeGet(answers))).pages).toBeNull();
  });

  test("a widget file that GitHub does not serve leaves the widget files unknown", async () => {
    const answers = widgetAnswers();
    answers.delete(`raw:repos/${slug}/contents/schemas/habits.json?ref=main`);
    answers.set(`raw:repos/${slug}/contents/schemas/habits.json?ref=main`, { status: 500, body: "" });
    expect((await readRepositoryFacts(slug, fakeGet(answers))).widgetFiles).toBeNull();
  });

  test("a schema that the tree does not list stays out, so the report can name it as missing", async () => {
    const answers = widgetAnswers();
    const tree = ["eva-widget.json"].map((path) => ({ path, type: "blob", sha: path }));
    answers.set(`repos/${slug}/git/trees/main?recursive=1`, ok({ truncated: false, tree }));
    expect((await readRepositoryFacts(slug, fakeGet(answers))).widgetFiles).toEqual({ "eva-widget.json": manifest });
  });
});
