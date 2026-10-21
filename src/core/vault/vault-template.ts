/**
 * A new vault from Eva's template: the files in `templates/vault/`, which
 * Bun embeds at build time, so the single executable carries them. The template holds nothing
 * personal; `eva setup` fills in the person's name, language, time zone and topics.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../shared/files.ts";
import { EvaError } from "../../shared/errors.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import agentsFile from "../../../templates/vault/AGENTS.md" with { type: "text" };
import readmeFile from "../../../templates/vault/README.md" with { type: "text" };
import gitignoreFile from "../../../templates/vault/.gitignore" with { type: "text" };
import assistantFile from "../../../templates/vault/.eva/assistant.md" with { type: "text" };
import aboutFile from "../../../templates/vault/Life/About me.md" with { type: "text" };
import scheduleSkillFile from "../../../templates/vault/.eva/skills/schedule/SKILL.md" with { type: "text" };

/**
 * The person's rules for Eva as a new vault gets them. They hold no setup answer, so the settings
 * page can restore them as they are.
 */
export const defaultAssistantRules: string = assistantFile;

/**
 * The parts of the template that Eva keeps aligned in each vault after an update, by path from the
 * vault root (`template-alignment.ts`). Add each new skill here.
 */
export const templateParts: Readonly<Record<string, string>> = {
  ".eva/skills/schedule/SKILL.md": scheduleSkillFile,
};

export interface VaultTemplateAnswers {
  readonly name: string;
  readonly language: string;
  readonly timeZone: string;
  /** The main topics of the person's life and work, in their own words. */
  readonly topics: readonly string[];
}

export interface NewVaultInputs {
  readonly folder: string;
  readonly answers: VaultTemplateAnswers;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
}

const gitTimeoutMs = 20_000;

/** The template's files, by path from the vault root, with the answers filled in. */
export function vaultTemplateFiles(answers: VaultTemplateAnswers): Record<string, string> {
  // "None yet." shows that the section is empty on purpose, not broken.
  const topicList = answers.topics.length === 0 ? "None yet." : answers.topics.map((topic) => `- ${topic}`).join("\n");
  const fill = (text: string): string =>
    text
      .replaceAll("{{name}}", answers.name)
      .replaceAll("{{language}}", answers.language)
      .replaceAll("{{timeZone}}", answers.timeZone)
      .replaceAll("{{topics}}", topicList);
  return {
    "AGENTS.md": agentsFile,
    "README.md": readmeFile,
    ".gitignore": gitignoreFile,
    ".eva/assistant.md": defaultAssistantRules,
    "Life/About me.md": fill(aboutFile),
    ".eva/schedules.json": JSON.stringify({ version: 1, schedules: [] }, null, 2) + "\n",
    ".eva/.claude-plugin/plugin.json":
      JSON.stringify(
        {
          name: "eva",
          description: "Eva's assistant skills for this vault. Eva loads this plugin in Assistant mode only.",
          version: "1.0.0",
        },
        null,
        2,
      ) + "\n",
    ...templateParts,
    // The empty top-level folders that AGENTS.md describes, so a new vault shows its shape.
    ...Object.fromEntries(
      ["Principles", "Methods", "Toolbox", "Library", "Projects"].map((folder) => [`${folder}/.gitkeep`, ""]),
    ),
  };
}

/** Writes the template into an empty or missing folder and makes its first commit. */
export async function createVaultFromTemplate(inputs: NewVaultInputs): Promise<void> {
  if (existsSync(inputs.folder) && readdirSync(inputs.folder).length > 0) {
    throw new EvaError("vault_not_found", `${inputs.folder} is not empty, so Eva does not put a new vault there.`);
  }
  for (const [path, content] of Object.entries(vaultTemplateFiles(inputs.answers))) {
    const target = join(inputs.folder, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileAtomic(target, content);
  }
  await git(inputs, ["init", "-q", "-b", "main"]);
  await git(inputs, ["add", "-A"]);
  // A machine with no git identity yet still gets its first commit.
  const identity = await inputs.runner.run(["git", "config", "user.email"], {
    cwd: inputs.folder,
    environment: inputs.environment,
    timeoutMs: gitTimeoutMs,
  });
  const fallback = identity.stdout.trim() === "" ? ["-c", "user.name=Eva", "-c", "user.email=eva@localhost"] : [];
  await git(inputs, [...fallback, "commit", "-q", "-m", "Start the vault from Eva's template"]);
}

async function git(inputs: NewVaultInputs, args: readonly string[]): Promise<void> {
  const result = await inputs.runner.run(["git", ...args], {
    cwd: inputs.folder,
    environment: inputs.environment,
    timeoutMs: gitTimeoutMs,
  });
  if (result.exitCode !== 0) throw new EvaError("git_failed", `git ${args.join(" ")} failed: ${result.stderr.trim()}`);
}
