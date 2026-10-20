/** The longer texts that the bot builds: a schedule card, the project list and an approval answer. */
import type { ScheduleCard } from "../../core/schedules/scheduler.ts";
import type { SessionEvent } from "../../shared/events.ts";
import { describeProjectLines } from "../cli/client.ts";
import { messageLimit } from "./telegram-sender.ts";

/** At most this many projects in one /projects answer: a longer list is hard to read on a phone. */
const projectListLimit = 20;

export function cardText(event: ScheduleCard): string {
  const heading =
    event.changed.length === 0
      ? `New schedule: ${event.name}`
      : `Schedule changed (${event.changed.join(", ")}): ${event.name}`;
  const fields = Object.entries(event.fields).map(([name, value]) => `${name}: ${value}`);
  const next = `Next run: ${event.nextRun?.replace("T", " ") ?? "never"} (${event.timeZone})`;
  // The card is the check against a schedule that someone else pushed to the vault (lesson 67).
  return [heading, "", ...fields, "", next].join("\n");
}

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
