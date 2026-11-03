/**
 * Eva's own skills, as the plugin `eva-core` (#771). They ship inside Eva, so an update reaches each
 * person, and Eva writes them outside the vault, in her engines folder. Only Assistant mode loads
 * them, before the vault's own plugin.
 *
 * A skill in the vault's `.eva/skills/` with the name of one of Eva's skills replaces it. Neither
 * engine does this by itself: Claude Code would load both, and pi keeps the first one. So a turn
 * gets a copy of `eva-core` without the replaced skills.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaRepository } from "../../shared/version.ts";
import manifestFile from "../../../templates/eva-core/.claude-plugin/plugin.json" with { type: "text" };
import aboutMeSkill from "../../../templates/eva-core/skills/about-me/SKILL.md" with { type: "text" };
import evaIssueSkill from "../../../templates/eva-core/skills/eva-issue/SKILL.md" with { type: "text" };
import evaRulesSkill from "../../../templates/eva-core/skills/eva-rules/SKILL.md" with { type: "text" };
import scheduleSkill from "../../../templates/eva-core/skills/schedule/SKILL.md" with { type: "text" };
import vaultUpgradeSkill from "../../../templates/eva-core/skills/vault-upgrade/SKILL.md" with { type: "text" };

/** Eva's skills, by name. Add each new skill of Eva here, not to the vault template. */
const evaCoreSkills: Readonly<Record<string, string>> = {
  "about-me": aboutMeSkill,
  // A fork of Eva gets issues in its own repository, as in the base prompt.
  "eva-issue": evaIssueSkill.replaceAll("{{evaRepository}}", evaRepository),
  "eva-rules": evaRulesSkill,
  schedule: scheduleSkill,
  "vault-upgrade": vaultUpgradeSkill,
};

export const evaCoreSkillNames: readonly string[] = Object.keys(evaCoreSkills).sort();

const pluginName = "eva-core";
const copyPrefix = `${pluginName}-without-`;

/** The plugin's files, by path from its folder, without the skills in `left`. */
export function evaCoreFiles(left: readonly string[] = []): Record<string, string> {
  const files: Record<string, string> = { ".claude-plugin/plugin.json": manifestFile };
  for (const name of evaCoreSkillNames) {
    if (!left.includes(name)) files[`skills/${name}/SKILL.md`] = evaCoreSkills[name] ?? "";
  }
  return files;
}

export class EvaCore {
  private readonly enginesFolder: string;
  private installed = false;

  /** `enginesFolder` is `<EVA_HOME>/engines/`, which only this instance uses. */
  constructor(enginesFolder: string) {
    this.enginesFolder = enginesFolder;
  }

  /**
   * The plugin folder for one turn: `eva-core`, or a copy without the skills that the vault replaces.
   * `vaultSkills` are the names of the skills in the vault's `.eva/skills/`.
   */
  folderFor(vaultSkills: readonly string[]): string {
    this.install();
    const replaced = evaCoreSkillNames.filter((name) => vaultSkills.includes(name));
    if (replaced.length === 0) return join(this.enginesFolder, pluginName);
    const folder = join(this.enginesFolder, `${copyPrefix}${replaced.join("-")}`);
    // Another chat may read a copy during its turn, so Eva writes each copy once and never rewrites it.
    if (!existsSync(folder)) writeFolder(folder, evaCoreFiles(replaced));
    return folder;
  }

  /**
   * Runs once in each Eva process, before its first turn, so no turn reads a folder that changes.
   * The copies of an earlier process may hold an older Eva's text, so they go.
   */
  private install(): void {
    if (this.installed) return;
    mkdirSync(this.enginesFolder, { recursive: true });
    for (const entry of readdirSync(this.enginesFolder)) {
      if (entry.startsWith(copyPrefix)) rmSync(join(this.enginesFolder, entry), { recursive: true, force: true });
    }
    const folder = join(this.enginesFolder, pluginName);
    const files = evaCoreFiles();
    if (!holds(folder, files)) {
      rmSync(folder, { recursive: true, force: true });
      writeFolder(folder, files);
    }
    this.installed = true;
  }
}

/** True when the folder holds these files with this text, and no other skill. */
function holds(folder: string, files: Readonly<Record<string, string>>): boolean {
  const skillsFolder = join(folder, "skills");
  if (!existsSync(skillsFolder)) return false;
  const skills = readdirSync(skillsFolder).sort();
  if (skills.join("\n") !== evaCoreSkillNames.join("\n")) return false;
  return Object.entries(files).every(([path, text]) => {
    const target = join(folder, path);
    return existsSync(target) && readFileSync(target, "utf-8") === text;
  });
}

/** Writes the files into a temporary folder, then renames it into place, so no turn sees half a plugin. */
function writeFolder(folder: string, files: Readonly<Record<string, string>>): void {
  const temporary = `${folder}.partial`;
  rmSync(temporary, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    const target = join(temporary, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  renameSync(temporary, folder);
}
