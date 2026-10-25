import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVaultFromTemplate,
  defaultAssistantRules,
  vaultTemplateFiles,
} from "../../../../src/core/vault/vault-template.ts";
import { vaultFolders } from "../../../../src/core/vault/vault-folders.ts";
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

const answers = { name: "Alex", language: "English", timeZone: "Europe/Madrid", topics: ["Work", "Music"] };

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync(["git", ...args], { cwd, env: environment })
    .stdout.toString()
    .trim();
}

describe("the vault template", () => {
  test("holds the agent map, Eva's files and no personal data", () => {
    const files = vaultTemplateFiles(answers);
    expect(Object.keys(files).sort()).toEqual([
      ".eva/.claude-plugin/plugin.json",
      ".eva/assistant.md",
      ".eva/schedules.json",
      ".eva/skills/about-me/SKILL.md",
      ".eva/skills/schedule/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "Library/.gitkeep",
      "Life/About me.md",
      "Methods/.gitkeep",
      "Principles/.gitkeep",
      "Projects/.gitkeep",
      "README.md",
      "Toolbox/.gitkeep",
    ]);
    expect(files["Life/About me.md"]).toContain("- **Name:** Alex");
    // The header holds the name as one YAML value, and every other fact empty.
    expect(files["Life/About me.md"]).toStartWith("---\n");
    expect(files["Life/About me.md"]).toContain('\nname: "Alex"\n');
    expect(files["Life/About me.md"]).toContain("## Main topics\n\n- Work\n- Music\n");
    // The rules hold no setup answer, so the settings page can restore them as they are.
    expect(files[".eva/assistant.md"]).toBe(defaultAssistantRules);
    expect(defaultAssistantRules).toContain("`Life/About me.md`");
    expect(vaultTemplateFiles({ ...answers, topics: [] })["Life/About me.md"]).toContain(
      "## Main topics\n\nNone yet.\n",
    );
    expect(files["Life/About me.md"]).toContain("Europe/Madrid");
    expect(Object.values(files).join("\n")).not.toContain("{{");
    expect(JSON.parse(files[".eva/schedules.json"] ?? "")).toEqual({ version: 1, schedules: [] });
    expect(files[".gitignore"]).toContain("Projects/*/repos/");
    expect(Object.keys(files).some((path) => path.endsWith("CLAUDE.md"))).toBe(false);
  });

  test("the agent map lists each top-level folder and tells the agent to grow the vault", () => {
    const map = vaultTemplateFiles(answers)["AGENTS.md"] ?? "";
    for (const folder of [
      "Principles/",
      "Methods/",
      "Toolbox/",
      "Library/",
      "Life/",
      "Projects/",
      "Scratch/",
      ".eva/",
    ]) {
      expect(map).toContain(`\`${folder}`);
    }
    expect(map).toContain("## Grow the vault");
  });

  test("each folder that setup describes is in the agent map and in the new vault", () => {
    const files = vaultTemplateFiles(answers);
    const map = files["AGENTS.md"] ?? "";
    for (const { path, purpose } of vaultFolders) {
      expect(map).toContain(`\`${path}/`);
      expect(purpose).not.toBe("");
      expect(Object.keys(files).some((file) => file.startsWith(`${path}/`))).toBe(true);
    }
  });

  test("a new vault is a git repository with one commit, even with no git identity", async () => {
    const vault = join(folder, "vault");
    await createVaultFromTemplate({ folder: vault, answers, runner: systemProcessRunner, environment });
    expect(readFileSync(join(vault, "Life", "About me.md"), "utf8")).toContain("Alex");
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
