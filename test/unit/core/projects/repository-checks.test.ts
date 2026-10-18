import { describe, expect, test } from "bun:test";
import { checksOf } from "../../../../src/core/projects/repository-checks.ts";

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
  });

  test("a script that does not exist counts by its name, and a cycle ends", () => {
    expect(kinds(["npm run lint", "yarn test:unit"])).toEqual(["lint", "test"]);
    expect(kinds(["npm run check"], { check: "npm run check" })).toEqual([]);
  });
});
