/**
 * The person's rules for Eva, in the vault's `.eva/assistant.md`, as the settings page edits them.
 * Assistant mode sends them after Eva's built-in prompt, and they win where the two disagree.
 * Project mode never sends them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { fileVersion, matchFileStyle } from "../projects/project-file.ts";
import { defaultAssistantRules } from "../vault/vault-template.ts";
import { formatLocalTime } from "./assistant-mode.ts";

export interface AssistantRulesFile {
  readonly text: string;
  /** A save names the version that it read, so a change that Eva made in a chat is never lost. */
  readonly version: string;
}

export interface AssistantRulesView extends AssistantRulesFile {
  /** Eva's built-in prompt, which the person reads but cannot change. */
  readonly builtIn: string;
  /** What "Restore the default" writes. */
  readonly defaultText: string;
}

export interface RestoredRules extends AssistantRulesFile {
  /** The copy of the old rules from the vault root, or null when the person asked for none. */
  readonly backup: string | null;
}

export interface AssistantRulesOptions {
  readonly vaultPath: string;
  readonly basePrompt: string;
  readonly now: () => Date;
  /** The backup's name carries the person's local time, which they recognise. */
  readonly timeZone: string;
}

export function assistantRulesPath(vaultPath: string): string {
  return join(vaultPath, ".eva", "assistant.md");
}

export class AssistantRules {
  private readonly options: AssistantRulesOptions;

  constructor(options: AssistantRulesOptions) {
    this.options = options;
  }

  read(): AssistantRulesView {
    return { ...this.file(), builtIn: this.options.basePrompt, defaultText: defaultAssistantRules };
  }

  save(version: string, edited: string): AssistantRulesFile {
    const before = this.checked(version);
    writeFileAtomic(this.path(), matchFileStyle(edited, before));
    return this.file();
  }

  /** Writes the default rules. With `backup`, it first copies the old rules next to them. */
  restoreDefault(version: string, backup: boolean): RestoredRules {
    const before = this.checked(version);
    const backupPath = backup && before.trim() !== "" ? this.writeBackup(before) : null;
    writeFileAtomic(this.path(), matchFileStyle(defaultAssistantRules, before));
    return { ...this.file(), backup: backupPath };
  }

  private file(): AssistantRulesFile {
    const text = existsSync(this.path()) ? readFileSync(this.path(), "utf-8") : "";
    return { text, version: fileVersion(text) };
  }

  /** The text on disk, when it still has the version that the page read. */
  private checked(version: string): string {
    assertVaultWritable(this.options.vaultPath);
    const { text, version: current } = this.file();
    if (current !== version) {
      throw new EvaError("rules_changed", "Your rules for Eva changed since you opened them. Load them again.");
    }
    return text;
  }

  private writeBackup(text: string): string {
    const stamp = formatLocalTime(this.options.now(), this.options.timeZone).replace(" ", "-").replace(":", "");
    let name = `.eva/assistant.backup-${stamp}.md`;
    for (let count = 2; existsSync(join(this.options.vaultPath, name)); count += 1) {
      name = `.eva/assistant.backup-${stamp}-${String(count)}.md`;
    }
    writeFileAtomic(join(this.options.vaultPath, name), text);
    return name;
  }

  private path(): string {
    return assistantRulesPath(this.options.vaultPath);
  }
}
