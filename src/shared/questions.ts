/** The rules of an answer to one question of the model, the same in the core, the engine and every front end. */
import type { ApprovalQuestion, QuestionAnswer } from "./events.ts";
import type { TurnRequest } from "./engine-port.ts";

/** A single choice replaces the last one. A multiple choice adds or removes the option. */
export function pickOption(selected: readonly number[], option: number, multiSelect: boolean): number[] {
  if (!multiSelect) return [option];
  return selected.includes(option)
    ? selected.filter((index) => index !== option)
    : [...selected, option].sort((a, b) => a - b);
}

/** Own text, or options in range: one for a single choice, and no option twice. */
export function answerFits(question: ApprovalQuestion, answer: QuestionAnswer): boolean {
  if ((answer.other?.trim() ?? "") !== "") return true;
  const { selected } = answer;
  if (selected.length === 0 || new Set(selected).size !== selected.length) return false;
  if (!question.multiSelect && selected.length > 1) return false;
  return selected.every((option) => Number.isInteger(option) && option >= 0 && option < question.options.length);
}

/**
 * The answer in words: own text, or the labels joined by ", ", as Claude Code's own form joins
 * them. Null for an answer that does not fit the question.
 */
export function answerText(question: ApprovalQuestion, answer: QuestionAnswer): string | null {
  if (!answerFits(question, answer)) return null;
  const other = answer.other?.trim() ?? "";
  if (other !== "") return other;
  return answer.selected.map((option) => question.options[option]?.label ?? "").join(", ");
}

/** Claude Code's name of its question form. pi gets a tool of the same name and input (#813). */
export const askUserQuestionTool = "AskUserQuestion";

/** For a form that Eva cannot read or that nobody answered: the question then reaches the person as a reply. */
export const askInTextMessage =
  "Eva could not show this question form, or nobody answered it in time. " +
  "Ask the same questions in your reply as plain text, with the options in a numbered list. " +
  "Then end your turn and wait for the person's answer in the chat.";

/** The answers by question text, or the message that tells the model why it has none. */
export type CollectedAnswers =
  | { readonly kind: "answered"; readonly answers: Readonly<Record<string, string>> }
  | { readonly kind: "refused"; readonly message: string };

/**
 * Shows the model's question form to the person, and gives the answers by question text, as
 * Claude Code's own form gives them. Each engine uses it, so a switch of engine changes nothing.
 */
export async function collectAnswers(
  input: Readonly<Record<string, unknown>>,
  ask: TurnRequest["askQuestions"],
): Promise<CollectedAnswers> {
  const questions = readQuestions(input);
  if (questions === null) return { kind: "refused", message: askInTextMessage };
  const outcome = await ask(askUserQuestionTool, questions);
  if (outcome === "declined") return { kind: "refused", message: "The person chose not to answer these questions." };
  if (outcome === "expired" || outcome.length !== questions.length)
    return { kind: "refused", message: askInTextMessage };
  const answers: Record<string, string> = {};
  for (const [index, question] of questions.entries()) {
    const answer = outcome[index];
    // The core checks the answers too. The engine checks again, as a wrong label would reach the model.
    const text = answer === undefined ? null : answerText(question, answer);
    if (text === null) return { kind: "refused", message: askInTextMessage };
    answers[question.question] = text;
  }
  return { kind: "answered", answers };
}

/** Null for an input that Eva cannot show as a form. Eva keeps only the fields that she shows. */
function readQuestions(input: Readonly<Record<string, unknown>>): ApprovalQuestion[] | null {
  const raw = input["questions"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: ApprovalQuestion[] = [];
  for (const entry of raw as unknown[]) {
    const question = recordOf(entry);
    const options = question["options"];
    if (typeof question["question"] !== "string" || !Array.isArray(options) || options.length === 0) return null;
    const read = (options as unknown[]).map((option) => {
      const fields = recordOf(option);
      return { label: fields["label"], description: fields["description"] ?? "" };
    });
    // An empty label would give a button with no text, which Telegram refuses, and an empty answer.
    const unreadable = (option: { label: unknown; description: unknown }): boolean =>
      typeof option.label !== "string" || option.label.trim() === "" || typeof option.description !== "string";
    if (read.some(unreadable)) return null;
    questions.push({
      question: question["question"],
      header: typeof question["header"] === "string" ? question["header"] : "",
      options: read as { label: string; description: string }[],
      multiSelect: question["multiSelect"] === true,
    });
  }
  // The answers go back by question text, so two equal texts would lose one answer.
  if (new Set(questions.map((question) => question.question)).size !== questions.length) return null;
  return questions;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
