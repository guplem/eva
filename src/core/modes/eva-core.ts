/**
 * Eva's own skills, as the plugin `eva-core` (#771). They ship inside Eva, so an update reaches each
 * person, and Eva writes them outside the vault, in her engines folder. Only Assistant mode loads
 * them, before the vault's own plugin.
 *
 * A skill in the vault's `.eva/skills/` with the name of one of Eva's skills replaces it. Neither
 * engine does this by itself: Claude Code would load both, and pi keeps the first one. So a turn
 * gets a copy of `eva-core` without the replaced skills.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Logger } from "../../shared/logger.ts";
import { evaRepository } from "../../shared/version.ts";
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

const manifestFile =
  JSON.stringify(
    {
      name: pluginName,
      description: "Eva's own skills. They ship with Eva, and Eva loads them in Assistant mode only.",
      version: "1.0.0",
    },
    null,
    2,
  ) + "\n";

/** The plugin's files, by path from its folder, without the skills in `left`. */
export function evaCoreFiles(left: readonly string[] = []): Record<string, string> {
  const files: Record<string, string> = { ".claude-plugin/plugin.json": manifestFile };
  for (const name of evaCoreSkillNames) {
    if (!left.includes(name)) files[`skills/${name}/SKILL.md`] = evaCoreSkills[name] ?? "";
  }
  return files;
}

/**
 * A short hash of this Eva's text, in the name of each copy. So a copy that an older Eva wrote, and
 * that Eva could not delete, never serves a turn of a newer Eva.
 */
const textHash = createHash("sha256").update(JSON.stringify(evaCoreFiles())).digest("hex").slice(0, 8);

export class EvaCore {
  private readonly enginesFolder: string;
  private readonly logger: Logger | null;
  private installed = false;

  /** `enginesFolder` is `<EVA_HOME>/engines/`, which only this instance uses. */
  constructor(enginesFolder: string, logger: Logger | null = null) {
    this.enginesFolder = enginesFolder;
    this.logger = logger;
  }

  /**
   * The plugin folder for one turn: `eva-core`, or a copy without the skills that the vault replaces.
   * `vaultSkills` are the names of the skills in the vault's `.eva/skills/`.
   */
  folderFor(vaultSkills: readonly string[]): string {
    const main = join(this.enginesFolder, pluginName);
    // A person or a clean-up tool can delete the folder while Eva runs.
    if (!existsSync(join(main, "skills"))) this.installed = false;
    this.install();
    const replaced = evaCoreSkillNames.filter((name) => vaultSkills.includes(name));
    if (replaced.length === 0) return main;
    const folder = join(this.enginesFolder, `${pluginName}-without-${replaced.join("-")}-${textHash}`);
    // Another chat may read a copy during its turn, so Eva writes each copy once and never rewrites it.
    if (!existsSync(folder)) writeFolder(folder, evaCoreFiles(replaced));
    return folder;
  }

  /**
   * Runs once in each Eva process, before its first turn, so no turn reads a folder that changes.
   * The copies and leftovers of an earlier process go, when the system lets Eva delete them.
   */
  private install(): void {
    if (this.installed) return;
    mkdirSync(this.enginesFolder, { recursive: true });
    const main = join(this.enginesFolder, pluginName);
    for (const entry of readdirSync(this.enginesFolder)) {
      if (entry.startsWith(`${pluginName}-without-`) || entry.startsWith(`${pluginName}.`))
        this.removeQuietly(join(this.enginesFolder, entry));
    }
    if (!holds(main, evaCoreFiles())) this.replace(main);
    this.installed = true;
  }

  /** Writes this Eva's text next to the folder, then swaps the two. On a failure the older text stays in use. */
  private replace(main: string): void {
    const stamp = String(Date.now());
    const fresh = `${main}.new-${stamp}`;
    const old = `${main}.old-${stamp}`;
    try {
      writeFolder(fresh, evaCoreFiles());
      if (existsSync(main)) renameSync(main, old);
      renameSync(fresh, main);
    } catch (error) {
      // Windows refuses to rename or delete a file that another program holds open.
      if (!existsSync(main) && existsSync(old)) renameSync(old, main);
      if (!existsSync(main)) throw error;
      this.logger?.log("warn", "Eva could not update her own skills, so the chats use the older ones.", {
        reason: String(error),
      });
      return;
    }
    this.removeQuietly(old);
  }

  private removeQuietly(path: string): void {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      this.logger?.log("warn", "Eva could not remove an old copy of her own skills.", {
        path,
        reason: String(error),
      });
    }
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
