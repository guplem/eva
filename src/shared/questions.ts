/** The rules of an answer to one question of the model, the same in the core, the engine and every front end. */
import type { ApprovalQuestion, QuestionAnswer } from "./events.ts";

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
