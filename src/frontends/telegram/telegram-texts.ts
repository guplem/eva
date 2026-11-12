/** The longer texts that the bot builds: the project list and an approval answer. */
import type { SessionEvent } from "../../shared/events.ts";
import { type OutwardActionCategory, outwardActionWords } from "../../shared/outward-actions.ts";
import { describeProjectLines } from "../cli/client.ts";
import { messageLimit } from "./telegram-sender.ts";

/** At most this many projects in one /projects answer: a longer list is hard to read on a phone. */
const projectListLimit = 20;

/** The /projects answer: whole projects only, within one message, and a note on what was left out. */
export function fitProjects(projects: Parameters<typeof describeProjectLines>[0]): string {
  const lines: string[] = [];
  let shown = 0;
  for (const project of projects.slice(0, projectListLimit)) {
    const block = describeProjectLines([project]);
    // The first project always shows; send() cuts it if it alone passes Telegram's size.
    if (shown > 0 && [...lines, ...block].join("\n").length > messageLimit) break;
    lines.push(...block);
    shown += 1;
  }
  if (projects.length === 0) return describeProjectLines([]).join("\n");
  const left = projects.length - shown;
  return [...lines, ...(left > 0 ? [`…and ${String(left)} more. Add words to narrow the search.`] : [])].join("\n");
}

export function approvalAnswerText(event: Extract<SessionEvent, { kind: "approval_resolved" }>): string {
  if (event.answer === "allow") return "Allowed";
  return event.timedOut ? "Denied (timed out)" : "Denied";
}

/** Allow and Deny always show. A request with categories adds "Do not ask again" on its own row. */
export function approvalKeyboard(
  requestId: string,
  categories: readonly OutwardActionCategory[],
): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows = [
    [
      { text: "Allow", callback_data: `a:${requestId}:allow` },
      { text: "Deny", callback_data: `a:${requestId}:deny` },
    ],
  ];
  if (categories.length > 0) rows.push([{ text: "Do not ask again", callback_data: `a:${requestId}:always` }]);
  return { inline_keyboard: rows };
}

/** The question before a level changes for good. It names every category of the request. */
export function alwaysConfirmText(categories: readonly OutwardActionCategory[]): string {
  const actions = categories.map((category) => outwardActionWords[category].title).join(", ");
  return (
    `Eva will do these with no question from now on: ${actions}. Are you sure? ` +
    "You can change this any time in Settings > AI engines > Actions that reach other people."
  );
}
