import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveAssistantPersonality } from "../../../../src/core/migrations/assistant-rules-move.ts";
import { runMigrations } from "../../../../src/core/migrations/migration-runner.ts";
import { homePaths, type HomePaths } from "../../../../src/core/settings/home.ts";

let root: string;
let paths: HomePaths;
let vault: string;
let rulesFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-assistant-move-"));
  paths = homePaths(join(root, "home"));
  vault = join(root, "vault");
  rulesFile = join(vault, ".eva", "assistant.md");
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(join(vault, ".eva"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function migrate(vaultPath: string | null = vault): void {
  const result = runMigrations({
    store: "vault",
    migrations: [moveAssistantPersonality],
    paths,
    vaultPath,
    version: "1.30.0",
    now: () => new Date("2026-10-20T08:00:00.000Z"),
  });
  expect(result.kind).toBe("done");
}

describe("moveAssistantPersonality (vault)", () => {
  test("appends the moved sections to rules that have none, and keeps the old text first", () => {
    writeFileSync(rulesFile, "# About Alex\n\n- **Name:** Alex\n");
    migrate();
    const text = readFileSync(rulesFile, "utf-8");
    expect(text.startsWith("# About Alex\n\n- **Name:** Alex\n\n## Answering from the notes\n")).toBe(true);
    expect(text).toContain("\n## Learning\n");
    expect(text).toContain("\n## Style\n");
  });

  test("keeps the Windows line endings of the file", () => {
    writeFileSync(rulesFile, "# About Alex\r\n");
    migrate();
    const text = readFileSync(rulesFile, "utf-8");
    expect(text.startsWith("# About Alex\r\n\r\n## Answering from the notes\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("leaves rules alone that already say how Eva learns", () => {
    const own = "# Rules\n\n  ## Learning\n\nMy own way.\n";
    writeFileSync(rulesFile, own);
    migrate();
    expect(readFileSync(rulesFile, "utf-8")).toBe(own);
  });

  test("does nothing without the rules file or without a vault", () => {
    migrate();
    expect(existsSync(rulesFile)).toBe(false);
    migrate(null);
  });
});
