/**
 * A new vault from Eva's template: the files in `templates/vault/`, which
 * Bun embeds at build time, so the single executable carries them. The template holds nothing
 * personal; `eva setup` fills in the person's name, the notes language and the topics. The answer
 * language and the formats go to the settings (#770).
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../../shared/files.ts";
import { EvaError } from "../../shared/errors.ts";
import { failureReason, type ProcessRunner } from "../../shared/process-runner.ts";
import { vaultFolders } from "./vault-folders.ts";
import { writeVaultKey } from "./secret-state.ts";
import { evaVersion } from "../../shared/version.ts";
import { moveAssistantPersonality } from "../migrations/assistant-rules-move.ts";
import { newVaultStructureFile } from "./vault-structure.ts";
import type { VaultKeyFile } from "./vault-crypto.ts";
import agentsFile from "../../../templates/vault/AGENTS.md" with { type: "text" };
import readmeFile from "../../../templates/vault/README.md" with { type: "text" };
import gitignoreFile from "../../../templates/vault/.gitignore" with { type: "text" };
import assistantFile from "../../../templates/vault/.eva/assistant.md" with { type: "text" };
import aboutFile from "../../../templates/vault/Life/About me.md" with { type: "text" };
import allergiesFile from "../../../templates/vault/Life/Health/Allergies and Diet.md" with { type: "text" };
import polishActionFile from "../../../templates/vault/.eva/settings/text-actions/Polish.md" with { type: "text" };
import summaryPromptFile from "../../../templates/vault/.eva/settings/saved-prompts/Summary.md" with { type: "text" };
import evaGuideFile from "../../../templates/vault/.eva/AGENTS.md" with { type: "text" };
import casesRulesFile from "../../../templates/vault/Life/Cases/AGENTS.md" with { type: "text" };
import objectsRulesFile from "../../../templates/vault/Life/Objects/AGENTS.md" with { type: "text" };
import peopleRulesFile from "../../../templates/vault/Life/People/AGENTS.md" with { type: "text" };
import petsRulesFile from "../../../templates/vault/Life/Pets/AGENTS.md" with { type: "text" };
import periodsRulesFile from "../../../templates/vault/Life/Periods/AGENTS.md" with { type: "text" };
import healthRulesFile from "../../../templates/vault/Life/Health/AGENTS.md" with { type: "text" };
import financesRulesFile from "../../../templates/vault/Life/Finances/AGENTS.md" with { type: "text" };
import diaryRulesFile from "../../../templates/vault/Life/Diary/AGENTS.md" with { type: "text" };

/**
 * The person's rules for Eva as a new vault gets them. They hold no setup answer, so the settings
 * page can restore them as they are.
 */
export const defaultAssistantRules: string = assistantFile;

/**
 * The parts of the template that Eva keeps aligned in each vault after an update, by path from the
 * vault root (`template-alignment.ts`). Add each new text action and saved prompt here. Eva's own skills
 * ship with Eva instead (`eva-core.ts`), and the person's own skills are no part of the template.
 */
export const templateParts: Readonly<Record<string, string>> = {
  // It describes only Eva's own folder, so it is true in every vault, an old one too (#772).
  ".eva/AGENTS.md": evaGuideFile,
  ".eva/settings/text-actions/Polish.md": polishActionFile,
  ".eva/settings/saved-prompts/Summary.md": summaryPromptFile,
};

/**
 * The rules of each folder in `Life/`. Only a new vault gets them: they are no template parts, so an
 * Eva update never adds a `Life/` folder to an old vault. The vault upgrade carries later changes (#773).
 */
const lifeRules: Readonly<Record<string, string>> = {
  "Life/Cases/AGENTS.md": casesRulesFile,
  "Life/Objects/AGENTS.md": objectsRulesFile,
  "Life/People/AGENTS.md": peopleRulesFile,
  "Life/Pets/AGENTS.md": petsRulesFile,
  "Life/Periods/AGENTS.md": periodsRulesFile,
  "Life/Health/AGENTS.md": healthRulesFile,
  "Life/Finances/AGENTS.md": financesRulesFile,
  "Life/Diary/AGENTS.md": diaryRulesFile,
};

/**
 * The newest texts of the template files that the vault upgrade writes or replaces, with their setup
 * placeholders, such as `{{name}}`. The `vault-upgrade` skill carries them (#773).
 */
export const upgradeTemplateTexts: Readonly<Record<string, string>> = {
  "AGENTS.md": agentsFile,
  "README.md": readmeFile,
  ".eva/assistant.md": assistantFile,
  "Life/About me.md": aboutFile,
  "Life/Health/Allergies and Diet.md": allergiesFile,
  ...lifeRules,
};

export interface VaultTemplateAnswers {
  readonly name: string;
  /** The language of every note in the vault. */
  readonly notesLanguage: string;
  /** The main topics of the person's life and work, in their own words. */
  readonly topics: readonly string[];
}

export interface NewVaultInputs {
  readonly folder: string;
  readonly answers: VaultTemplateAnswers;
  /** The vault's key, wrapped with its password, so the first commit holds it (#707). */
  readonly key: VaultKeyFile;
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
}

const gitTimeoutMs = 20_000;

/**
 * The frozen migration of 2026-10-20 appends the sections that the base prompt holds now (#771). A
 * new vault records it as applied, so its short rules stay short. The hub runs every other migration.
 */
const appliedAtStart = moveAssistantPersonality.id;

/** The template's files, by path from the vault root, with the answers filled in. */
export function vaultTemplateFiles(answers: VaultTemplateAnswers, now: Date = new Date()): Record<string, string> {
  // "None yet." shows that the section is empty on purpose, not broken.
  const topicList = answers.topics.length === 0 ? "None yet." : answers.topics.map((topic) => `- ${topic}`).join("\n");
  const fill = (text: string): string =>
    text
      // A JSON string is a YAML string too: the escapes keep any name one value in the header.
      .replaceAll("{{nameInQuotes}}", JSON.stringify(answers.name).slice(1, -1))
      .replaceAll("{{name}}", answers.name)
      .replaceAll("{{notesLanguage}}", answers.notesLanguage)
      .replaceAll("{{topics}}", topicList);
  const files: Record<string, string> = {
    "AGENTS.md": fill(agentsFile),
    "README.md": readmeFile,
    ".gitignore": gitignoreFile,
    ".eva/assistant.md": defaultAssistantRules,
    "Life/About me.md": fill(aboutFile),
    "Life/Health/Allergies and Diet.md": allergiesFile,
    ...lifeRules,
    // The newest version of the vault-upgrade CHANGELOG, so a new vault shows no upgrade (#773).
    ".eva/vault-structure.json": newVaultStructureFile(),
    ".eva/schedules.json": JSON.stringify({ version: 1, schedules: [] }, null, 2) + "\n",
    ".eva/migrations.json":
      JSON.stringify({ applied: [{ id: appliedAtStart, at: now.toISOString(), version: evaVersion }] }, null, 2) + "\n",
    ".eva/.claude-plugin/plugin.json":
      JSON.stringify(
        {
          name: "eva",
          description: "Your own skills for Eva. Eva loads this plugin in Assistant mode only.",
          version: "1.0.0",
        },
        null,
        2,
      ) + "\n",
    ...templateParts,
  };
  // Git keeps no empty folder, so each folder with no file yet gets a `.gitkeep`, and a new vault shows its shape.
  for (const { path } of vaultFolders) {
    if (!Object.keys(files).some((file) => file.startsWith(`${path}/`))) files[`${path}/.gitkeep`] = "";
  }
  return files;
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
  writeVaultKey(inputs.folder, inputs.key);
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
  if (result.exitCode !== 0)
    throw new EvaError("git_failed", `git ${args.join(" ")} failed: ${failureReason(result, "git")}`);
}
