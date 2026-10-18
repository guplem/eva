/**
 * Names a chat after its first turn, by the person's rules in the vault's `.eva/chat-names.md`
 * (issue 50). Without rules, the chat keeps the first line of its first message, and no model runs.
 */
import { join } from "node:path";
import { readTextTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";
import { assertVaultWritable } from "../migrations/migrations.ts";
import { cheapestModel, type ModelCalls } from "../model-calls/model-calls.ts";
import type { FirstTurn } from "./session-manager.ts";

/** Enough of each text to name the chat, and a small call. */
const sentTextLength = 2_000;

const systemPrompt = [
  "You name chats. Answer with the name only: one line, at most 60 characters, with no quotes.",
  "Follow the person's rules. Write the name in the language of the first message, unless a rule says otherwise.",
].join("\n");

export function chatNameRulesPath(vaultPath: string): string {
  return join(vaultPath, ".eva", "chat-names.md");
}

export interface ChatNamerOptions {
  readonly vaultPath: string;
  readonly modelCalls: Pick<ModelCalls, "ask">;
  readonly logger?: Logger;
}

export class ChatNamer {
  private readonly options: ChatNamerOptions;

  constructor(options: ChatNamerOptions) {
    this.options = options;
  }

  /** The person's rules, or an empty text for none. */
  rules(): string {
    return readTextTolerant(chatNameRulesPath(this.options.vaultPath))?.trim() ?? "";
  }

  /** An empty text turns the names off. The idle sweep commits the file, as it does a note. */
  saveRules(text: string): void {
    assertVaultWritable(this.options.vaultPath);
    const rules = text.trim();
    writeFileAtomic(chatNameRulesPath(this.options.vaultPath), rules.length === 0 ? "" : `${rules}\n`);
  }

  /** The name, or null to keep the first line. It reads the rules on each call, so an edit applies at once. */
  async name(turn: FirstTurn): Promise<string | null> {
    const rules = this.rules();
    if (rules.length === 0) return null;
    const result = await this.options.modelCalls.ask({
      engine: turn.engine,
      model: cheapestModel(turn.engine, turn.model),
      systemPrompt,
      prompt: "Name this chat.",
      context: {
        rules,
        "first-message": cut(turn.userText),
        "first-answer": cut(turn.answerText),
      },
    });
    if (!result.ok) {
      this.options.logger?.log("warn", `A chat name failed: ${result.reason}`);
      return null;
    }
    return cleanName(result.text);
  }
}

function cut(text: string): string {
  const characters = Array.from(text);
  return characters.length > sentTextLength ? `${characters.slice(0, sentTextLength).join("")}…` : text;
}

/** A model can add a reason on later lines, or wrap the name in quotes. */
function cleanName(text: string): string | null {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0) ?? "";
  const name = line
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return name.length > 0 ? name : null;
}
