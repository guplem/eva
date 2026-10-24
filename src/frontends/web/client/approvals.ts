/** The parts of a permission request that need no page: where it comes from and what it asks. */
import type { PendingApproval, SessionEvent, SessionRecord } from "./api.ts";
import type { ApprovalQuestion, QuestionAnswers } from "../../../shared/events.ts";
import { toolCategory } from "../../../shared/outward-actions.ts";

/** The approvals of the sessions that the page does not show now. They get a notice instead of a card. */
export function approvalsOutside(
  approvals: readonly PendingApproval[],
  shownSessionIds: readonly string[],
): PendingApproval[] {
  return approvals.filter((approval) => !shownSessionIds.includes(approval.sessionId));
}

/** A tool name has no space. A question of Eva herself, such as "Trust this repository", is its own title. */
export function approvalTitle(toolName: string, questions?: readonly ApprovalQuestion[]): string {
  if (questions !== undefined) {
    return questions.length === 1 ? "Eva has a question" : `Eva has ${String(questions.length)} questions`;
  }
  if (toolName.includes(" ")) return toolName;
  return toolCategory(toolName) === "command" ? "Eva wants to run a command" : `Eva wants to use ${toolName}`;
}

/** The clone of a project chat, or the title of an assistant chat. */
export function approvalPlace(session: Pick<SessionRecord, "mode" | "title" | "clone"> | undefined): string {
  if (session === undefined) return "another chat";
  return session.mode === "project" && session.clone !== null ? `clone ${session.clone}` : session.title;
}

/** The words before the place, in the line for a request of a chat that is not on screen. */
export function approvalNoticeWords(questions: readonly ApprovalQuestion[] | undefined): string {
  return questions === undefined ? "Eva needs your permission in" : "Eva has a question in";
}

/** The choices of one question while the person picks, before Send. */
export interface QuestionDraft {
  readonly selected: readonly number[];
  readonly other: string;
}

/** A single choice replaces the last one. A multiple choice adds or removes the option. */
export function pickOption(selected: readonly number[], option: number, multiSelect: boolean): number[] {
  if (!multiSelect) return [option];
  return selected.includes(option)
    ? selected.filter((index) => index !== option)
    : [...selected, option].sort((a, b) => a - b);
}

/** Null until each question has a choice or own text. Own text wins, as the core reads it. */
export function questionAnswers(
  questions: readonly ApprovalQuestion[],
  drafts: readonly QuestionDraft[],
): QuestionAnswers | null {
  const answers = questions.map((_question, index) => {
    const draft = drafts[index];
    const other = draft?.other.trim() ?? "";
    if (other !== "") return { selected: [], other };
    return draft !== undefined && draft.selected.length > 0 ? { selected: [...draft.selected] } : null;
  });
  return answers.every((answer) => answer !== null) ? answers : null;
}

/** The pending request that an event announces. A spread would copy the event's seq and time too. */
export function pendingOf(event: Extract<SessionEvent, { kind: "approval_needed" }>): PendingApproval {
  const { requestId, sessionId, toolName, summary, questions } = event;
  return { requestId, sessionId, toolName, summary, ...(questions === undefined ? {} : { questions }) };
}
