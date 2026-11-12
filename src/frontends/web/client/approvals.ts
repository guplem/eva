/** The parts of a permission request that need no page: where it comes from and what it asks. */
import type { PendingApproval, SessionEvent, SessionRecord } from "./api.ts";
import type { ApprovalQuestion, QuestionAnswers } from "../../../shared/events.ts";
import { outwardActionWords, toolCategory, type OutwardActionCategory } from "../../../shared/outward-actions.ts";
import { chatKind } from "../../../shared/chat-kind.ts";

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
  return session.clone !== null && chatKind(session) === "project" ? `clone ${session.clone}` : session.title;
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
  const { requestId, sessionId, toolName, summary, questions, categories } = event;
  return {
    requestId,
    sessionId,
    toolName,
    summary,
    ...(questions === undefined ? {} : { questions }),
    ...(categories === undefined ? {} : { categories }),
  };
}

/**
 * The words of the "Do not ask again" question. The page puts the link to Settings after `tail`,
 * so the link is a real link and not text. The lead names every category of the request.
 */
export function alwaysAllowWords(categories: readonly OutwardActionCategory[]): { lead: string; tail: string } {
  const names = categories.map((category) => `"${outwardActionWords[category].title}"`);
  const joined =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}` : names.join("");
  const noun = names.length > 1 ? "actions" : "action";
  return {
    lead: `Eva will do the ${noun} ${joined} with no question from now on.`,
    tail: "Are you sure? You can change this any time in",
  };
}
