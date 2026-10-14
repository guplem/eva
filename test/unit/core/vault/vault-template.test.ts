import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultFromTemplate, vaultTemplateFiles } from "../../../../src/core/vault/vault-template.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner, type ProcessRunner } from "../../../../src/shared/process-runner.ts";

let folder: string;
let environment: Record<string, string>;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-template-"));
  const emptyConfig = join(folder, "empty.gitconfig");
  writeFileSync(emptyConfig, "");
  // No git identity at all: the template must still make its first commit.
  environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => !entry[0].startsWith("GIT_") && entry[1] !== undefined,
      ),
    ),
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const answers = { name: "Alex", language: "English", timeZone: "Europe/Madrid" };

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync(["git", ...args], { cwd, env: environment })
    .stdout.toString()
    .trim();
}

describe("the vault template (plan §11)", () => {
  test("holds the agent map, Eva's files and no personal data", () => {
    const files = vaultTemplateFiles(answers);
    expect(Object.keys(files).sort()).toEqual([
      ".eva/.claude-plugin/plugin.json",
      ".eva/assistant.md",
      ".eva/schedules.json",
      ".eva/skills/schedule/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "Notes/.gitkeep",
      "Projects/.gitkeep",
      "README.md",
    ]);
    expect(files[".eva/assistant.md"]).toContain("- **Name:** Alex");
    expect(files[".eva/assistant.md"]).toContain("Europe/Madrid");
    expect(Object.values(files).join("\n")).not.toContain("{{");
    expect(JSON.parse(files[".eva/schedules.json"] ?? "")).toEqual({ version: 1, schedules: [] });
    expect(files[".gitignore"]).toContain("Projects/*/repos/");
    expect(Object.keys(files).some((path) => path.endsWith("CLAUDE.md"))).toBe(false);
  });

  test("a new vault is a git repository with one commit, even with no git identity", async () => {
    const vault = join(folder, "vault");
    await createVaultFromTemplate({ folder: vault, answers, runner: systemProcessRunner, environment });
    expect(readFileSync(join(vault, ".eva", "assistant.md"), "utf8")).toContain("Alex");
    expect(git(vault, "log", "--format=%an %s")).toBe("Eva Start the vault from Eva's template");
    expect(git(vault, "status", "--porcelain")).toBe("");
    expect(git(vault, "branch", "--show-current")).toBe("main");
  });

  test("a folder that already holds files is refused", async () => {
    mkdirSync(join(folder, "used"));
    writeFileSync(join(folder, "used", "note.md"), "mine");
    let caught: unknown;
    try {
      await createVaultFromTemplate({
        folder: join(folder, "used"),
        answers,
        runner: systemProcessRunner,
        environment,
      });
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "vault_not_found")).toBe(true);
  });

  test("a failed git step is an error that names the step", async () => {
    const failing: ProcessRunner = { run: () => Promise.resolve({ exitCode: 128, stdout: "", stderr: "no git here" }) };
    const failure = await createVaultFromTemplate({
      folder: join(folder, "other"),
      answers,
      runner: failing,
      environment,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("git init -q -b main failed: no git here");
  });
});
