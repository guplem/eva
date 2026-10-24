/**
 * Writes a short summary of a chat, so a new chat can go on from it (issue 522). The summary
 * becomes the draft of the new chat's first message, and the person reads it before it goes.
 */
import type { Logger } from "../../shared/logger.ts";
import { cheapestModel, type ModelCallResult, type ModelCalls } from "../model-calls/model-calls.ts";
import type { SessionRecord } from "./session-store.ts";

/** A long chat keeps its newest turns: the open work is at its end. */
const historyLength = 40_000;
const textLength = 4_000;
/** A summary takes longer than a chat name. */
const summaryTimeoutMs = 180_000;

const systemPrompt = [
  "You summarize a chat between a person and an AI agent. A new chat starts with your summary, so the agent can go on without the old chat.",
  "Write it to the agent of the new chat. Use these four parts, each with a short heading:",
  "Goal: what the person wants.",
  "Done: what the chat did, with its results.",
  "Left to do: the open work and the open questions.",
  "Branches and files: the git branches, pull requests and files involved. Read the git state when it is given.",
  "Use short sentences and lists. Write at most 300 words. Write in the language of the chat.",
  "Answer with the summary only.",
].join("\n");

/** The first line of the draft, so the new chat's agent knows what the text is. */
export const summaryLead = "This chat goes on from an earlier chat. Here is a summary of it.";

export interface ChatSummaryInput {
  readonly engine: SessionRecord["engine"];
  readonly model: SessionRecord["modelAlias"];
  /** The turns of the branch, oldest first. Already redacted. */
  readonly turns: readonly Pick<SessionRecord["turns"][number], "userText" | "answerText" | "failure">[];
  /** The git state of a Project chat's clone, or null. */
  readonly gitState: string | null;
}

export interface ChatSummarizerOptions {
  readonly modelCalls: Pick<ModelCalls, "ask">;
  readonly logger?: Logger;
}

export class ChatSummarizer {
  private readonly options: ChatSummarizerOptions;

  constructor(options: ChatSummarizerOptions) {
    this.options = options;
  }

  /** The draft of the first message, or a failure with a reason for the person. Never throws. */
  async summarize(input: ChatSummaryInput): Promise<ModelCallResult> {
    if (input.turns.length === 0) return { ok: false, failure: "failed", reason: "The chat has no messages yet." };
    const result = await this.options.modelCalls.ask({
      engine: input.engine,
      model: cheapestModel(input.engine, input.model),
      systemPrompt,
      prompt: "Summarize this chat.",
      context: {
        chat: transcript(input.turns),
        ...(input.gitState === null ? {} : { "git-state": input.gitState }),
      },
      timeoutMs: summaryTimeoutMs,
    });
    if (!result.ok) {
      this.options.logger?.log("warn", `A chat summary failed: ${result.reason}`);
      return result;
    }
    const summary = result.text.trim();
    if (summary.length === 0) return { ok: false, failure: "failed", reason: "The model gave an empty summary." };
    return { ok: true, text: `${summaryLead}\n\n${summary}` };
  }
}

/** The newest turns that fit, oldest first. A note says when older turns are left out. */
function transcript(turns: ChatSummaryInput["turns"]): string {
  const parts: string[] = [];
  let length = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    const answer = turn.failure === null ? cut(turn.answerText) : `The turn failed: ${cut(turn.failure)}`;
    const part = `Person: ${cut(turn.userText)}\n\nAgent: ${answer}`;
    // The newest turn always goes, even when it is long: it holds the open work.
    if (parts.length > 0 && length + part.length > historyLength) {
      parts.push(`(${String(index + 1)} older turns are left out.)`);
      break;
    }
    parts.push(part);
    length += part.length;
  }
  return parts.reverse().join("\n\n---\n\n");
}

function cut(text: string): string {
  const characters = Array.from(text);
  return characters.length > textLength ? `${characters.slice(0, textLength).join("")}…` : text;
}
