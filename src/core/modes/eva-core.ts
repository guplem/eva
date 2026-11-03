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

/** Renames a file or a folder. A seam, so a test can refuse a rename as Windows does. */
export type Rename = (from: string, to: string) => void;

/** The codes of a refusal that can pass: on Windows, another program holds a file open for a moment. */
const passingRefusals = new Set(["EPERM", "EBUSY", "EACCES"]);
const renameAttempts = 4;

export class EvaCore {
  private readonly enginesFolder: string;
  private readonly logger: Logger | null;
  private readonly renameOnce: Rename;
  /** True once this process removed the copies of an earlier one. */
  private swept = false;
  private installed = false;

  /** `enginesFolder` is `<EVA_HOME>/engines/`, which only this instance uses. */
  constructor(enginesFolder: string, logger: Logger | null = null, rename: Rename = renameSync) {
    this.enginesFolder = enginesFolder;
    this.logger = logger;
    this.renameOnce = rename;
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
    if (existsSync(folder)) return folder;
    // Another chat may read a copy during its turn, so Eva writes each copy once and never rewrites it.
    try {
      this.writeFolder(folder, evaCoreFiles(replaced));
      return folder;
    } catch (error) {
      // Both versions of a replaced skill then load, which is better than none of Eva's skills.
      this.logger?.log("warn", "Eva could not leave out the skills that the vault replaces.", {
        reason: String(error),
      });
      return main;
    }
  }

  /**
   * Runs before the first turn of each Eva process, and again when `eva-core` is gone or out of date.
   * Only the first run removes the copies and leftovers of an earlier process: later, a running chat
   * may read a copy.
   */
  private install(): void {
    if (this.installed) return;
    mkdirSync(this.enginesFolder, { recursive: true });
    const main = join(this.enginesFolder, pluginName);
    if (!this.swept) {
      for (const entry of readdirSync(this.enginesFolder)) {
        if (entry.startsWith(`${pluginName}-without-`) || entry.startsWith(`${pluginName}.`))
          this.removeQuietly(join(this.enginesFolder, entry));
      }
      this.swept = true;
    }
    this.installed = holds(main, evaCoreFiles()) || this.replace(main);
  }

  /**
   * Writes this Eva's text next to the folder, then swaps the two. On a failure the older text stays
   * in use. True when the folder holds this Eva's text.
   */
  private replace(main: string): boolean {
    const stamp = String(Date.now());
    const fresh = `${main}.new-${stamp}`;
    const old = `${main}.old-${stamp}`;
    try {
      this.writeFolder(fresh, evaCoreFiles());
      if (existsSync(main)) this.rename(main, old);
      this.rename(fresh, main);
    } catch (error) {
      if (!existsSync(main) && existsSync(old)) this.rename(old, main);
      if (!existsSync(main)) throw error;
      this.removeQuietly(fresh);
      this.logger?.log("warn", "Eva could not update her own skills, so the chats use the older ones.", {
        reason: String(error),
      });
      return false;
    }
    this.removeQuietly(old);
    return true;
  }

  /** Writes the files into a temporary folder, then renames it into place, so no turn sees half a plugin. */
  private writeFolder(folder: string, files: Readonly<Record<string, string>>): void {
    const temporary = `${folder}.partial`;
    rmSync(temporary, { recursive: true, force: true });
    for (const [path, text] of Object.entries(files)) {
      const target = join(temporary, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
    try {
      this.rename(temporary, folder);
    } catch (error) {
      this.removeQuietly(temporary);
      throw error;
    }
  }

  /** A rename, tried again a few times while Windows holds a file open. */
  private rename(from: string, to: string): void {
    for (let attempt = 1; ; attempt += 1) {
      try {
        this.renameOnce(from, to);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt >= renameAttempts || !passingRefusals.has(code)) throw error;
        Bun.sleepSync(attempt * 25);
      }
    }
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
