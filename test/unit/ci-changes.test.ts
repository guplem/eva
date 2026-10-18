/**
 * Tests for the docs-only rule of the CI workflow (#103).
 * The file has no `src/` twin: it tests `scripts/ci-changes.ts`, which only CI runs.
 */
import { describe, expect, test } from "bun:test";
import { codeChanged, isDocsPath } from "../../scripts/ci-changes.ts";

describe("isDocsPath", () => {
  test.each([
    "README.md",
    "SECURITY.md",
    "AGENTS.md",
    "docs/guide/start.md",
    ".agents/skills/write-commit/SKILL.md",
    "src/core/modes/AGENTS.md",
    "src/core/modes/CLAUDE.md",
    "test/AGENTS.md",
  ])("%s is docs", (path) => {
    expect(isDocsPath(path)).toBe(true);
  });

  test.each([
    "src/main.ts",
    // The assistant prompt ships inside the executable.
    "src/core/modes/assistant-base-prompt.md",
    "test/fixtures/note.md",
    // The vault template ships inside the executable.
    "templates/vault/README.md",
    "templates/vault/AGENTS.md",
    "templates/vault/.eva/skills/schedule/SKILL.md",
    "docs/diagram.png",
    // Upper case is rare: when in doubt, the full set runs.
    "docs/NOTES.MD",
    ".agents/skills/example/run.sh",
    ".github/workflows/pull-request-checks.yml",
    "package.json",
    "bun.lock",
    "bunfig.toml",
  ])("%s is code", (path) => {
    expect(isDocsPath(path)).toBe(false);
  });
});

describe("codeChanged", () => {
  test("only docs paths mean no code changed", () => {
    expect(codeChanged(["AGENTS.md", "docs/guide/start.md"])).toBe(false);
  });

  test("one code path among docs means code changed", () => {
    expect(codeChanged(["AGENTS.md", "src/main.ts"])).toBe(true);
  });

  test("an empty list means code changed, so the full set runs", () => {
    expect(codeChanged([])).toBe(true);
  });
});
