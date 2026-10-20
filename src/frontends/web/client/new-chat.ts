/**
 * The words of an empty chat: EVE's greeting, and the suggestions that show what Eva does well.
 * Each suggestion is a request that Eva can do today, with the vault's notes, skills and tools.
 */
import type { ChatBlocker } from "./api.ts";
import type { IconName } from "./icons.tsx";
import { settingsHash } from "./settings-routes.ts";

export interface Suggestion {
  /** The request that a tap sends. */
  readonly title: string;
  /** What Eva does with it, in one line. */
  readonly detail: string;
  readonly icon: IconName;
}

/** The greeting for an hour of the person's day, from 0 to 23. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning.";
  if (hour >= 12 && hour < 18) return "Good afternoon.";
  return "Good evening.";
}

const notes: Suggestion = {
  title: "Summarize yesterday's notes",
  detail: "Reads the vault and tells you what is new",
  icon: "file",
};
const calendar: Suggestion = {
  title: "What do I have this week?",
  detail: "Checks the calendar and the tasks",
  icon: "calendar",
};
// Eva makes the project's folder from the vault's rules. She cannot make a repository yet.
const project: Suggestion = { title: "Create a project", detail: "Makes its folder in the vault", icon: "folder" };
const reminder: Suggestion = {
  title: "Remind me of something",
  detail: "Sets a schedule that messages you",
  icon: "clock",
};

/** The calendar needs the Google tools, so it shows only when Google is set up. */
export function suggestions(googleReady: boolean): readonly Suggestion[] {
  return googleReady ? [notes, calendar, project, reminder] : [notes, project, reminder];
}

/** The words and the link of a chat that cannot answer until a setup step is done. */
export interface SetupBlock {
  readonly sentence: string;
  /** The main button, which opens the step. */
  readonly action: string;
  /** The line under the locked message box. */
  readonly composerLine: string;
  readonly address: string;
}

const blockWords: Readonly<Record<ChatBlocker, { readonly needs: string; readonly action: string }>> = {
  engine: { needs: "an AI engine", action: "Set up an AI engine" },
  vault: { needs: "your vault", action: "Set up your vault" },
};

export function setupBlock(blocker: ChatBlocker): SetupBlock {
  const words = blockWords[blocker];
  return {
    sentence: `Eva needs ${words.needs} before she can answer.`,
    action: words.action,
    composerLine: `${words.action} to send a message.`,
    address: settingsHash({ section: "setup", item: blocker }),
  };
}
