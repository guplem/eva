import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { checksOf } from "../../../../src/core/projects/repository-checks.ts";

const root = fileURLToPath(new URL("../../../..", import.meta.url));

function kinds(commands: readonly string[], scripts: Readonly<Record<string, string>> = {}): string[] {
  return [...checksOf(commands, scripts)].sort();
}

describe("checksOf", () => {
  test("knows the common tools of each stack", () => {
    expect(kinds(["npx eslint ."])).toEqual(["lint"]);
    expect(kinds(["prettier --check ."])).toEqual(["format"]);
    expect(kinds(["bun test --coverage"])).toEqual(["test"]);
    expect(kinds(["python -m pytest -q"])).toEqual(["test"]);
    expect(kinds(["uv run ruff check ."])).toEqual(["lint"]);
    expect(kinds(["ruff format --check ."])).toEqual(["format"]);
    expect(kinds(["go vet ./...", "go test ./..."])).toEqual(["lint", "test"]);
    expect(kinds(["cargo fmt --check && cargo clippy && cargo test"])).toEqual(["format", "lint", "test"]);
    expect(kinds(["bundle exec rubocop"])).toEqual(["lint"]);
    expect(kinds(["vendor/bin/phpunit"])).toEqual(["test"]);
    expect(kinds(["npx biome ci ."])).toEqual(["format", "lint"]);
    expect(kinds(["golangci/golangci-lint-action@v6"])).toEqual(["lint"]);
  });

  test("an argument or a setup step is not a check", () => {
    expect(kinds(["eslint src test"])).toEqual(["lint"]);
    expect(kinds(["bunx playwright install --with-deps chromium"])).toEqual([]);
    expect(kinds(["actions/checkout@v4", "actions/attest-build-provenance@v1", "bun install"])).toEqual([]);
    expect(kinds(["CI=true npx playwright test"])).toEqual(["test"]);
    expect(kinds(["for file in a b; do test -e $file && exit 1; done"])).toEqual([]);
  });

  test("a wrapper, a shell word or a monorepo runner does not hide the tool", () => {
    expect(kinds(["git diff --name-only | xargs eslint"])).toEqual(["lint"]);
    expect(kinds(["if [ -f a ]; then npm test; fi"])).toEqual(["test"]);
    expect(kinds(["timeout 60 pytest", "cross-env NODE_ENV=production jest"])).toEqual(["test"]);
    expect(kinds(["turbo run lint", "pnpm --filter web test"])).toEqual(["lint", "test"]);
    expect(kinds(["bundle exec rake test", "./mvnw test", "yarn workspace web test"])).toEqual(["test"]);
  });

  test("an argument of another program is not a check", () => {
    const deploys = [
      "helm upgrade app . --namespace test",
      "gh workflow run test.yml",
      "grep -r lint .",
      "tar czf lint.tgz out",
    ];
    expect(kinds(deploys)).toEqual([]);
    expect(kinds(["bun run build"], { build: "vite build --mode test" })).toEqual([]);
  });

  test("an install, a message or a comment runs no check", () => {
    expect(kinds(["npm install -D eslint", "pip install pytest", "go install golang.org/x/lint"])).toEqual([]);
    expect(kinds(["echo Running the tests", "cd test"])).toEqual([]);
    expect(kinds(["# run the linter; ruff is fast\nnpm ci"])).toEqual([]);
    expect(kinds(["npx commitlint --from HEAD~1"])).toEqual([]);
  });

  test("follows a package script into the commands that it runs", () => {
    const scripts = {
      check: "bun run check:static && bun run test:coverage",
      "check:static": "bun run format:check && bun run lint && bun run typecheck",
      "format:check": "prettier --check .",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      "test:coverage": "bun test --coverage",
    };
    expect(kinds(["bun run check"], scripts)).toEqual(["format", "lint", "test"]);
    expect(kinds(["npm test"], { test: "vitest run" })).toEqual(["test"]);
    expect(kinds(["pnpm verify"], { verify: "eslint ." })).toEqual(["lint"]);
    expect(kinds(["npm test"], { pretest: "eslint .", test: "node run.js" })).toEqual(["lint"]);
  });

  test("a script that does not exist counts by its name, and a cycle ends", () => {
    expect(kinds(["npm run lint", "yarn test:unit"])).toEqual(["lint", "test"]);
    expect(kinds(["npm run check"], { check: "npm run check" })).toEqual([]);
  });
});

describe("checksOf on Eva's own repository, the reference of the setup report", () => {
  interface Steps {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  }
  type Hooks = Record<string, { commands: Record<string, { run: string }> }>;
  const read = (path: string): string => readFileSync(`${root}/${path}`, "utf8");
  const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

  test("the pull-request CI runs the format check, the lint and the tests", () => {
    const workflow = parseYaml(read(".github/workflows/pull-request-checks.yml")) as Steps;
    const commands = Object.values(workflow.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => step.run ?? []));
    expect([...checksOf(commands, scripts)].sort()).toEqual(["format", "lint", "test"]);
  });

  test("the git hooks run the format check and the lint before each commit and each push", () => {
    const hooks = parseYaml(read("lefthook.yml")) as Hooks;
    for (const hook of ["pre-commit", "pre-push"]) {
      const commands = Object.values(hooks[hook]?.commands ?? {}).map((command) => command.run);
      expect([...checksOf(commands, scripts)].sort()).toEqual(["format", "lint"]);
    }
  });
});
