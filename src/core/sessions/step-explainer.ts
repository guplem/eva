/**
 * Explains one step of an answer in plain words (issue 963): a command or a tool call, as a short
 * numbered list that a person who does not read shell code can follow. It runs only when the person
 * asks for it, in the cheapest model, outside every chat.
 */
import type { Logger } from "../../shared/logger.ts";
import { cheapestModel, type ModelCallResult, type ModelCalls } from "../model-calls/model-calls.ts";
import type { SessionRecord } from "./session-store.ts";

/** Enough of a step to explain it, and a small, fast call. */
const inputLength = 6_000;
const outputLength = 2_000;
const chatTextLength = 300;
const explainTimeoutMs = 60_000;

const systemPrompt = [
  "You explain what one step of an AI agent did, for a person who does not read code.",
  "The input holds a shell command or the arguments of a tool. The output, when given, is what came back.",
  "Say what the step does in plain words, as a numbered list: 1. first this, 2. then that.",
  "One short sentence for each action, such as open a page, read a file, create a file, delete a folder, or run a program.",
  "Name the real files, folders, addresses and programs. Skip flags and syntax that do not change the meaning.",
  "When a part could lose data, such as a delete or an overwrite, say so in that item.",
  "When the output shows that the step failed, add one last line that says why.",
  "Use at most 8 items. Write in the language of the chat text when it is given, otherwise in English.",
  "Answer with the list only.",
].join("\n");

export interface StepExplainInput {
  readonly engine: SessionRecord["engine"];
  readonly model: SessionRecord["modelAlias"];
  readonly kind: "command" | "tool";
  /** The input of the step, already redacted. */
  readonly input: string;
  readonly output?: string;
  /** The person's latest message, only to choose the language. */
  readonly chatText?: string;
}

export interface StepExplainerOptions {
  readonly modelCalls: Pick<ModelCalls, "ask">;
  readonly logger?: Logger;
}

export class StepExplainer {
  private readonly options: StepExplainerOptions;

  constructor(options: StepExplainerOptions) {
    this.options = options;
  }

  /** The explanation, or a failure with a reason for the person. Never throws. */
  async explain(step: StepExplainInput): Promise<ModelCallResult> {
    if (step.input.trim() === "") {
      return {
        ok: false,
        failure: "failed",
        reason: "Eva kept no input for this step, so there is nothing to explain.",
      };
    }
    const result = await this.options.modelCalls.ask({
      engine: step.engine,
      model: cheapestModel(step.engine, step.model),
      systemPrompt,
      prompt: `Explain this ${step.kind === "command" ? "shell command" : "tool call"}.`,
      context: {
        input: cut(step.input, inputLength),
        ...(step.output === undefined || step.output === "" ? {} : { output: cut(step.output, outputLength) }),
        ...(step.chatText === undefined || step.chatText === ""
          ? {}
          : { "chat-language": cut(step.chatText, chatTextLength) }),
      },
      timeoutMs: explainTimeoutMs,
    });
    if (!result.ok) {
      this.options.logger?.log("warn", `A step explanation failed: ${result.reason}`);
      return result;
    }
    const text = result.text.trim();
    if (text.length === 0) return { ok: false, failure: "failed", reason: "The model gave an empty explanation." };
    return { ok: true, text };
  }
}

function cut(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : text;
}
