/** The parts of a permission request that need no page: where it comes from and what it asks. */
import type { PendingApproval, SessionRecord } from "./api.ts";
import { toolCategory } from "../../../shared/outward-actions.ts";

/** The approvals of the sessions that the page does not show now. They get a notice instead of a card. */
export function approvalsOutside(
  approvals: readonly PendingApproval[],
  shownSessionIds: readonly string[],
): PendingApproval[] {
  return approvals.filter((approval) => !shownSessionIds.includes(approval.sessionId));
}

/** A tool name has no space. A question of Eva herself, such as "Trust this repository", is its own title. */
export function approvalTitle(toolName: string): string {
  if (toolName.includes(" ")) return toolName;
  return toolCategory(toolName) === "command" ? "Eva wants to run a command" : `Eva wants to use ${toolName}`;
}

/** The clone of a project chat, or the title of an assistant chat. */
export function approvalPlace(session: Pick<SessionRecord, "mode" | "title" | "clone"> | undefined): string {
  if (session === undefined) return "another chat";
  return session.mode === "project" && session.clone !== null ? `clone ${session.clone}` : session.title;
}
