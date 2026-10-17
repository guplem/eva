import { describe, expect, test } from "bun:test";
import { ghApiGet, readRepositoryFacts, type GithubAnswer } from "../../../../src/core/projects/repository-facts.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

const slug = "owner/example-app";

function ok(body: unknown): GithubAnswer {
  return { status: 200, body: JSON.stringify(body) };
}

const workflow = "name: checks\non:\n  pull_request:\njobs:\n  checks:\n    runs-on: ubuntu-latest\n";
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
    [`repos/${slug}/labels?per_page=100`, ok([{ name: "bug" }, { name: "owner" }])],
    [`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, { status: 200, body: workflow }],
    [`raw:repos/${slug}/contents/.github/workflows/codeql.yaml?ref=main`, { status: 200, body: codeql }],
    [
      `raw:repos/${slug}/contents/.claude/settings.json?ref=main`,
      { status: 200, body: JSON.stringify({ permissions: { allow: ["Read", 7, "Bash(git log*)"] } }) },
    ],
    [`repos/${slug}/rules/branches/main`, ok([{ type: "deletion" }, { type: "required_status_checks" }])],
    [`repos/${slug}/branches/main`, ok({ protected: false })],
    [`repos/${slug}/private-vulnerability-reporting`, ok({ enabled: true })],
    [`repos/${slug}/vulnerability-alerts`, { status: 204, body: "" }],
    [`repos/${slug}/automated-security-fixes`, ok({ enabled: false })],
    [`repos/${slug}/code-scanning/default-setup`, ok({ state: "not-configured" })],
    [`repos/${slug}/actions/permissions/workflow`, ok({ default_workflow_permissions: "read" })],
  ]);
}

function fakeGet(answers: Map<string, GithubAnswer>, asked: string[] = []) {
  return (path: string, raw = false): Promise<GithubAnswer> => {
    const key = raw ? `raw:${path}` : path;
    asked.push(key);
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
      dependabotSecurityUpdates: false,
      secretScanning: true,
      pushProtection: false,
      codeScanningDefaultSetup: false,
      readOnlyWorkflowToken: true,
    });
    expect(facts.files).toEqual({
      "AGENTS.md": "a1",
      ".github/workflows/checks.yml": "w1",
      ".github/workflows/codeql.yaml": "w2",
      ".claude/settings.json": "s1",
    });
    expect(facts.workflows).toEqual([
      { path: ".github/workflows/checks.yml", runsOnPullRequest: true, usesCodeql: false },
      { path: ".github/workflows/codeql.yaml", runsOnPullRequest: false, usesCodeql: true },
    ]);
  });

  test("an admin-only answer that GitHub refuses is null, and a 404 on the alerts is off only for an admin", async () => {
    const answers = fullAnswers();
    const forbidden: GithubAnswer = { status: 403, body: '{"message":"Must have admin rights"}' };
    answers.set(`repos/${slug}`, ok({ default_branch: "main", private: false, permissions: { admin: false } }));
    answers.set(`repos/${slug}/code-scanning/default-setup`, forbidden);
    answers.set(`repos/${slug}/actions/permissions/workflow`, forbidden);
    answers.delete(`repos/${slug}/vulnerability-alerts`);
    answers.delete(`repos/${slug}/rules/branches/main`);
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts).toMatchObject({
      isAdmin: false,
      allowAutoMerge: null,
      secretScanning: null,
      codeScanningDefaultSetup: null,
      readOnlyWorkflowToken: null,
      dependabotAlerts: null,
      requiredChecks: false,
    });

    answers.set(`repos/${slug}`, ok({ default_branch: "main", private: false, permissions: { admin: true } }));
    expect((await readRepositoryFacts(slug, fakeGet(answers))).dependabotAlerts).toBe(false);
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

  test("a settings file that is not JSON gives no allow list, and a broken workflow does not run on pull requests", async () => {
    const answers = fullAnswers();
    answers.set(`raw:repos/${slug}/contents/.claude/settings.json?ref=main`, { status: 200, body: "{ not json" });
    answers.set(`raw:repos/${slug}/contents/.github/workflows/checks.yml?ref=main`, { status: 200, body: "on: [" });
    const facts = await readRepositoryFacts(slug, fakeGet(answers));
    expect(facts.allowRules).toBeNull();
    expect(facts.workflows?.[0]?.runsOnPullRequest).toBe(false);
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

describe("ghApiGet", () => {
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
    const get = ghApiGet(runner, { PATH: "x" });
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
    expect(String(await failure(ghApiGet(failing, {})("repos/a/b")))).toContain("gh auth login");
    const loggedOut: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 4,
          stdout: "",
          stderr: "To get started with GitHub CLI, please run: gh auth login",
        }),
    };
    expect(String(await failure(ghApiGet(loggedOut, {})("repos/a/b")))).toContain("please run: gh auth login");
  });
});

function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => new Error("no failure"),
    (error: unknown) => error,
  );
}
